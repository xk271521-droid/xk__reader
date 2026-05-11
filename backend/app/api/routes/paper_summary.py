from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import Paper, PaperSummary, User
from app.schemas.paper_summary import (
    PaperSummaryGenerateRequest,
    PaperSummaryListResponse,
    PaperSummaryState,
    PaperSummaryStatusResponse,
    PaperSummaryType,
)
from app.services.paper_summary import (
    SUMMARY_TYPES,
    build_summary_response_payload,
    is_summary_stale,
    run_paper_summary_task,
    stale_summary_message,
)

router = APIRouter(prefix="/papers/{paper_id}/summaries")


def _ensure_owned_paper(db: Session, paper_id: int, user: User) -> Paper:
    paper = db.scalar(
        select(Paper).where(
            Paper.id == paper_id,
            Paper.user_id == user.id,
            Paper.deleted_at.is_(None),
        )
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在或无权访问。")
    return paper


def _ensure_summary_type(summary_type: str) -> str:
    if summary_type not in SUMMARY_TYPES:
        raise HTTPException(status_code=404, detail="未知的总结类型。")
    return summary_type


def _load_summary(db: Session, paper_id: int, user_id: int, summary_type: str) -> PaperSummary | None:
    return db.scalar(
        select(PaperSummary).where(
            PaperSummary.paper_id == paper_id,
            PaperSummary.user_id == user_id,
            PaperSummary.summary_type == summary_type,
        )
    )


@router.get("", response_model=PaperSummaryListResponse)
def list_paper_summaries(
    paper_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperSummaryListResponse:
    paper = _ensure_owned_paper(db, paper_id, current_user)
    items = db.scalars(
        select(PaperSummary).where(
            PaperSummary.paper_id == paper_id,
            PaperSummary.user_id == current_user.id,
        )
    ).all()
    by_type = {item.summary_type: item for item in items}
    states = []
    for summary_type in SUMMARY_TYPES:
        item = by_type.get(summary_type)
        stale = is_summary_stale(db, paper, item)
        states.append(
            PaperSummaryState(
                **build_summary_response_payload(
                    item,
                    summary_type,
                    is_stale=stale,
                    stale_message=stale_summary_message(summary_type) if stale else None,
                )
            )
        )
    return PaperSummaryListResponse(summaries=states)


@router.post("/{summary_type}/generate", response_model=PaperSummaryStatusResponse)
def generate_paper_summary(
    paper_id: int,
    summary_type: PaperSummaryType,
    payload: PaperSummaryGenerateRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperSummaryStatusResponse:
    _ensure_summary_type(summary_type)
    paper = _ensure_owned_paper(db, paper_id, current_user)
    item = _load_summary(db, paper_id, current_user.id, summary_type)
    stale = is_summary_stale(db, paper, item)

    if item and item.status == "running":
        return PaperSummaryStatusResponse(**build_summary_response_payload(item, summary_type))

    if item and item.status == "generated" and not payload.force and not stale:
        return PaperSummaryStatusResponse(**build_summary_response_payload(item, summary_type))

    if not item:
        item = PaperSummary(
            paper_id=paper_id,
            user_id=current_user.id,
            summary_type=summary_type,
            content_json={},
        )

    item.status = "running"
    item.stage = "extracting_context"
    item.progress = 3
    item.provider_id = payload.provider_id
    item.error_message = None
    db.add(item)
    db.commit()
    db.refresh(item)

    background_tasks.add_task(run_paper_summary_task, item.id, payload.provider_id)
    return PaperSummaryStatusResponse(**build_summary_response_payload(item, summary_type))


@router.get("/{summary_type}/status", response_model=PaperSummaryStatusResponse)
def get_paper_summary_status(
    paper_id: int,
    summary_type: PaperSummaryType,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PaperSummaryStatusResponse:
    _ensure_summary_type(summary_type)
    paper = _ensure_owned_paper(db, paper_id, current_user)
    item = _load_summary(db, paper_id, current_user.id, summary_type)
    if not item:
        return PaperSummaryStatusResponse(
            status="idle",
            stage="idle",
            progress=0,
            summary=None,
            is_stale=False,
            error_message=None,
            updated_at=None,
            model="",
        )
    stale = is_summary_stale(db, paper, item)
    return PaperSummaryStatusResponse(
        **build_summary_response_payload(
            item,
            summary_type,
            is_stale=stale,
            stale_message=stale_summary_message(summary_type) if stale else None,
        )
    )
