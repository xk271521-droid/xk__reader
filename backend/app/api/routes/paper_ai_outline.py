from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Paper, PaperAiOutline, User
from app.schemas.paper_ai_outline import PaperAiOutlineEnsureRequest, PaperAiOutlineResponse
from app.services.background_task_runner import spawn_paper_ai_outline_worker_process
from app.services.paper_ai_outline import (
    PAPER_AI_NATIVE_OUTLINE_PROMPT_VERSION,
    PAPER_AI_OUTLINE_PROMPT_VERSION,
    build_paper_ai_outline_response,
    mark_running_ai_outline_stale,
    native_paper_outline_hash,
    normalize_native_paper_outline,
    paper_source_fingerprint,
)


router = APIRouter(prefix="/papers/{paper_id}/ai-outline", tags=["paper-ai-outline"])


def _load_owned_paper(db: Session, paper_id: int, user_id: int) -> Paper:
    paper = db.scalar(select(Paper).where(
        Paper.id == paper_id,
        Paper.user_id == user_id,
        Paper.deleted_at.is_(None),
    ))
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在或无权访问。")
    return paper


def _load_outline(db: Session, paper_id: int) -> PaperAiOutline | None:
    return db.scalar(select(PaperAiOutline).where(PaperAiOutline.paper_id == paper_id))


def _refresh_outline_state(
    db: Session,
    paper: Paper,
    item: PaperAiOutline | None,
    *,
    expected_prompt_version: str | None = None,
) -> PaperAiOutline | None:
    if not item:
        return None
    changed = mark_running_ai_outline_stale(item)
    fingerprint = paper_source_fingerprint(paper.file_path)
    if (
        item.status == "completed"
        and (
            (expected_prompt_version and item.prompt_version != expected_prompt_version)
            or (fingerprint and item.source_fingerprint != fingerprint)
        )
    ):
        item.status = "idle"
        item.stage = "stale"
        item.progress = 0
        item.error_message = None
        changed = True
    if changed:
        db.add(item)
        db.commit()
        db.refresh(item)
    return item


def _start_worker(db: Session, item: PaperAiOutline, provider_id: int | None) -> PaperAiOutline:
    try:
        spawn_paper_ai_outline_worker_process(item.id, provider_id)
    except Exception as exc:
        item.status = "failed"
        item.stage = "failed"
        item.error_message = f"启动目录生成失败：{exc}"
        db.add(item)
        db.commit()
        db.refresh(item)
    return item


@router.get("", response_model=PaperAiOutlineResponse)
def get_paper_ai_outline(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperAiOutlineResponse:
    paper = _load_owned_paper(db, paper_id, current_user.id)
    item = _refresh_outline_state(db, paper, _load_outline(db, paper_id))
    return PaperAiOutlineResponse(**build_paper_ai_outline_response(item))


def _invalidate_outline(item: PaperAiOutline) -> None:
    item.status = "idle"
    item.stage = "stale"
    item.progress = 0
    item.error_message = None


@router.post("/ensure", response_model=PaperAiOutlineResponse)
def ensure_paper_ai_outline(
    paper_id: int,
    payload: PaperAiOutlineEnsureRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperAiOutlineResponse:
    paper = _load_owned_paper(db, paper_id, current_user.id)
    native_outline = normalize_native_paper_outline(payload.native_outline)
    has_native_outline = bool(native_outline["items"])
    expected_prompt_version = (
        PAPER_AI_NATIVE_OUTLINE_PROMPT_VERSION if has_native_outline else PAPER_AI_OUTLINE_PROMPT_VERSION
    )
    native_hash = native_paper_outline_hash(native_outline) if has_native_outline else ""
    item = _refresh_outline_state(
        db,
        paper,
        _load_outline(db, paper_id),
        expected_prompt_version=expected_prompt_version,
    )
    if item and item.status in {"completed", "failed"} and (
        item.prompt_version != expected_prompt_version
        or (has_native_outline and item.source_hash != native_hash)
    ):
        _invalidate_outline(item)
        db.add(item)
        db.commit()
        db.refresh(item)
    if item and item.status in {"completed", "queued", "running", "failed"}:
        return PaperAiOutlineResponse(**build_paper_ai_outline_response(item))

    if item:
        item.status = "queued"
        item.stage = "queued"
        item.progress = 0
        item.prompt_version = expected_prompt_version
        # Store the normalized native tree until the detached worker begins. The
        # model can add Chinese titles, but never alter its page links or English text.
        item.content_json = {"_native_outline": native_outline["items"]} if has_native_outline else {}
        item.source_hash = native_hash
        item.error_message = None
        item.provider_id = None
        item.model = ""
    else:
        item = PaperAiOutline(
            paper_id=paper_id,
            user_id=current_user.id,
            status="queued",
            stage="queued",
            progress=0,
            prompt_version=expected_prompt_version,
            source_hash=native_hash,
            content_json={"_native_outline": native_outline["items"]} if has_native_outline else {},
        )
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        existing = _refresh_outline_state(db, paper, _load_outline(db, paper_id))
        if existing:
            return PaperAiOutlineResponse(**build_paper_ai_outline_response(existing))
        raise

    item = _start_worker(db, item, payload.provider_id)
    return PaperAiOutlineResponse(**build_paper_ai_outline_response(item))


@router.post("/retry", response_model=PaperAiOutlineResponse)
def retry_paper_ai_outline(
    paper_id: int,
    payload: PaperAiOutlineEnsureRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperAiOutlineResponse:
    paper = _load_owned_paper(db, paper_id, current_user.id)
    native_outline = normalize_native_paper_outline(payload.native_outline)
    expected_prompt_version = (
        PAPER_AI_NATIVE_OUTLINE_PROMPT_VERSION if native_outline["items"] else PAPER_AI_OUTLINE_PROMPT_VERSION
    )
    item = _refresh_outline_state(
        db,
        paper,
        _load_outline(db, paper_id),
        expected_prompt_version=expected_prompt_version,
    )
    if not item:
        return ensure_paper_ai_outline(paper_id, payload, current_user, db)
    if item.status in {"completed", "queued", "running"}:
        return PaperAiOutlineResponse(**build_paper_ai_outline_response(item))

    item.status = "idle"
    item.stage = "idle"
    item.progress = 0
    item.error_message = None
    db.add(item)
    db.commit()
    return ensure_paper_ai_outline(paper_id, payload, current_user, db)
