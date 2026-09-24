from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Paper, PaperReadingBrief, User
from app.schemas.paper_reading_brief import (
    PaperReadingBriefEnsureRequest,
    PaperReadingBriefResponse,
)
from app.services.background_task_runner import spawn_paper_reading_brief_worker_process
from app.services.paper_reading_brief import (
    PAPER_READING_BRIEF_PROMPT_VERSION,
    build_reading_brief_response,
    mark_running_brief_stale,
)

router = APIRouter(prefix="/papers/{paper_id}/reading-brief", tags=["paper-reading-brief"])


def _load_owned_paper(db: Session, paper_id: int, user_id: int) -> Paper:
    paper = db.scalar(
        select(Paper).where(
            Paper.id == paper_id,
            Paper.user_id == user_id,
            Paper.deleted_at.is_(None),
        )
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在或无权访问。")
    return paper


def _load_brief(db: Session, paper_id: int) -> PaperReadingBrief | None:
    return db.scalar(
        select(PaperReadingBrief).where(PaperReadingBrief.paper_id == paper_id)
    )


def _refresh_stale_running_brief(db: Session, item: PaperReadingBrief | None) -> PaperReadingBrief | None:
    if item and mark_running_brief_stale(item):
        db.add(item)
        db.commit()
        db.refresh(item)
    return item


def _start_brief_worker(db: Session, item: PaperReadingBrief, provider_id: int | None) -> PaperReadingBrief:
    try:
        spawn_paper_reading_brief_worker_process(item.id, provider_id)
    except Exception as exc:
        item.status = "failed"
        item.stage = "failed"
        item.error_message = f"启动文献速读生成失败：{exc}"
        db.add(item)
        db.commit()
        db.refresh(item)
    return item


@router.get("", response_model=PaperReadingBriefResponse)
def get_paper_reading_brief(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperReadingBriefResponse:
    _load_owned_paper(db, paper_id, current_user.id)
    item = _refresh_stale_running_brief(db, _load_brief(db, paper_id))
    return PaperReadingBriefResponse(**build_reading_brief_response(item))


@router.post("/ensure", response_model=PaperReadingBriefResponse)
def ensure_paper_reading_brief(
    paper_id: int,
    payload: PaperReadingBriefEnsureRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperReadingBriefResponse:
    _load_owned_paper(db, paper_id, current_user.id)
    item = _refresh_stale_running_brief(db, _load_brief(db, paper_id))

    # A completed brief is immutable during ordinary opens: serve the database
    # record without touching the PDF or calling the model again.
    if item and item.status in {"completed", "queued", "running", "failed"}:
        return PaperReadingBriefResponse(**build_reading_brief_response(item))

    item = PaperReadingBrief(
        paper_id=paper_id,
        user_id=current_user.id,
        status="queued",
        stage="queued",
        progress=0,
        prompt_version=PAPER_READING_BRIEF_PROMPT_VERSION,
        content_json={},
    )
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        # Two tabs can open the same paper together. The unique paper_id row is
        # the lock: the losing request simply reads the already-created task.
        db.rollback()
        existing = _refresh_stale_running_brief(db, _load_brief(db, paper_id))
        if existing:
            return PaperReadingBriefResponse(**build_reading_brief_response(existing))
        raise

    item = _start_brief_worker(db, item, payload.provider_id)
    return PaperReadingBriefResponse(**build_reading_brief_response(item))


@router.post("/retry", response_model=PaperReadingBriefResponse)
def retry_paper_reading_brief(
    paper_id: int,
    payload: PaperReadingBriefEnsureRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperReadingBriefResponse:
    _load_owned_paper(db, paper_id, current_user.id)
    item = _refresh_stale_running_brief(db, _load_brief(db, paper_id))
    if not item:
        return ensure_paper_reading_brief(paper_id, payload, current_user, db)
    if item.status in {"completed", "queued", "running"}:
        return PaperReadingBriefResponse(**build_reading_brief_response(item))

    item.status = "queued"
    item.stage = "queued"
    item.progress = 0
    item.error_message = None
    item.provider_id = None
    item.model = ""
    db.add(item)
    db.commit()
    db.refresh(item)
    item = _start_brief_worker(db, item, payload.provider_id)
    return PaperReadingBriefResponse(**build_reading_brief_response(item))


@router.post("/refresh", response_model=PaperReadingBriefResponse)
def refresh_paper_reading_brief(
    paper_id: int,
    payload: PaperReadingBriefEnsureRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperReadingBriefResponse:
    """Explicitly regenerate a cached brief; ordinary opens remain cache-only."""
    _load_owned_paper(db, paper_id, current_user.id)
    item = _refresh_stale_running_brief(db, _load_brief(db, paper_id))
    if not item:
        return ensure_paper_reading_brief(paper_id, payload, current_user, db)
    if item.status in {"queued", "running"}:
        return PaperReadingBriefResponse(**build_reading_brief_response(item))

    item.status = "queued"
    item.stage = "queued"
    item.progress = 0
    item.error_message = None
    item.provider_id = None
    item.model = ""
    item.prompt_version = PAPER_READING_BRIEF_PROMPT_VERSION
    db.add(item)
    db.commit()
    db.refresh(item)
    item = _start_brief_worker(db, item, payload.provider_id)
    return PaperReadingBriefResponse(**build_reading_brief_response(item))
