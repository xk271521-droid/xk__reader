from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import PaperFullTranslation, User
from app.schemas.task import (
    TaskCenterArchiveRequest,
    TaskCenterArchiveResponse,
    TaskCenterResponse,
    TaskCenterSummaryResponse,
)
from app.services.task_center import (
    archive_task_entries,
    build_task_center_payload,
    find_task_entry,
    finished_task_ids,
    task_source_label,
)


router = APIRouter(prefix="/tasks", tags=["tasks"])


def _response_payload(db: Session, user_id: int, limit: int = 50) -> TaskCenterResponse:
    return TaskCenterResponse(**build_task_center_payload(db, user_id, limit=limit))


@router.get("", response_model=TaskCenterResponse)
def get_task_center(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> TaskCenterResponse:
    return _response_payload(db, current_user.id, limit)


@router.get("/summary", response_model=TaskCenterSummaryResponse)
def get_task_center_summary(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> TaskCenterSummaryResponse:
    return TaskCenterSummaryResponse(**build_task_center_payload(db, current_user.id, limit=1)["summary"])


def _require_retryable_task(db: Session, user_id: int, task_id: str) -> dict:
    entry = find_task_entry(db, user_id, task_id)
    if not entry:
        raise HTTPException(status_code=404, detail="任务不存在或无访问权限。")
    if not entry["can_retry"]:
        raise HTTPException(status_code=409, detail="当前任务不需要重试。")
    return entry


@router.post("/{task_id}/cancel")
def cancel_task(
    task_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, str]:
    entry = find_task_entry(db, current_user.id, task_id)
    if not entry:
        raise HTTPException(status_code=404, detail="任务不存在或无访问权限。")
    if entry["source_kind"] != "full_translation" or not entry["can_cancel"]:
        raise HTTPException(status_code=409, detail="当前任务无法取消。")

    item = db.get(PaperFullTranslation, entry["source_id"])
    if not item:
        raise HTTPException(status_code=404, detail="任务记录已不存在。")
    item.status = "cancelled"
    item.error_message = "已取消全文翻译。"
    db.add(item)
    db.commit()
    return {"id": task_id, "status": "cancelled"}


@router.post("/{task_id}/retry")
def retry_task(
    task_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, str]:
    entry = _require_retryable_task(db, current_user.id, task_id)
    paper_id = int(entry["action_payload"].get("paper_id") or 0)
    if not paper_id:
        raise HTTPException(status_code=404, detail="任务关联论文已不存在。")

    # Reuse the feature endpoints so task-center retries stay consistent with
    # provider selection, worker startup and the normal reader workflow.
    if entry["source_kind"] == "full_translation":
        from app.api.routes.paper import retranslate_full_translation
        from app.schemas.paper import FullTranslationStartRequest

        retranslate_full_translation(paper_id, FullTranslationStartRequest(), current_user, db)
    elif entry["source_kind"] == "reading_brief":
        from app.api.routes.paper_reading_brief import retry_paper_reading_brief
        from app.schemas.paper_reading_brief import PaperReadingBriefEnsureRequest

        retry_paper_reading_brief(paper_id, PaperReadingBriefEnsureRequest(), current_user, db)
    elif entry["source_kind"] == "ai_outline":
        from app.api.routes.paper_ai_outline import retry_paper_ai_outline
        from app.schemas.paper_ai_outline import PaperAiOutlineEnsureRequest

        retry_paper_ai_outline(
            paper_id,
            PaperAiOutlineEnsureRequest(
                native_outline=entry["action_payload"].get("native_outline"),
            ),
            current_user,
            db,
        )
    else:
        raise HTTPException(status_code=409, detail=f"{task_source_label(entry['source_kind'])}暂不支持重试。")
    return {"id": task_id, "status": "queued"}


@router.post("/archive", response_model=TaskCenterArchiveResponse)
def archive_tasks(
    payload: TaskCenterArchiveRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> TaskCenterArchiveResponse:
    archived_ids, skipped_ids = archive_task_entries(db, current_user.id, payload.task_ids)
    snapshot = build_task_center_payload(db, current_user.id)
    return TaskCenterArchiveResponse(
        archived_ids=archived_ids,
        archived_count=len(archived_ids),
        skipped_ids=skipped_ids,
        summary=snapshot["summary"],
    )


@router.post("/archive-completed", response_model=TaskCenterArchiveResponse)
@router.post("/archive-finished", response_model=TaskCenterArchiveResponse)
def archive_finished_tasks(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> TaskCenterArchiveResponse:
    archived_ids, skipped_ids = archive_task_entries(
        db,
        current_user.id,
        finished_task_ids(db, current_user.id),
    )
    snapshot = build_task_center_payload(db, current_user.id)
    return TaskCenterArchiveResponse(
        archived_ids=archived_ids,
        archived_count=len(archived_ids),
        skipped_ids=skipped_ids,
        summary=snapshot["summary"],
    )
