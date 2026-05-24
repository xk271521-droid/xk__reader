from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.orm import Session, load_only, selectinload

from app.api.deps import get_current_user
from app.api.routes.research_matrix import _ensure_matrix_worker_started
from app.core.config import settings
from app.db.session import get_db
from app.models import Paper, PaperFullTranslation, PaperSummary, ResearchMatrixRun, TaskCenterArchive, User
from app.schemas.task import (
    TaskCenterArchiveRequest,
    TaskCenterArchiveResponse,
    TaskCenterItemResponse,
    TaskCenterResponse,
    TaskCenterSummaryResponse,
)
from app.services.background_task_runner import spawn_full_translation_worker_process
from app.services.membership import should_start_summary_immediately
from app.services.paper_summary import (
    SUMMARY_TYPES,
    _start_next_queued_summary_if_possible,
    spawn_paper_summary_worker,
    summary_title,
)
from app.services.research_matrix import (
    RUN_STAGE_LABELS,
    _start_next_queued_matrix_run_if_possible,
    normalize_run_runtime_state,
    retry_pending_run,
)
from app.services.task_monitor import normalize_stale_tasks

router = APIRouter(prefix="/tasks", tags=["tasks"])

ACTIVE_STATUSES = {"queued", "running"}
FAILED_STATUSES = {"failed", "error", "partial_failed", "cancelled"}
COMPLETED_STATUSES = {"generated", "completed"}
STATUS_PRIORITY = {
    "failed": 0,
    "error": 0,
    "cancelled": 1,
    "running": 2,
    "queued": 3,
    "generated": 4,
    "completed": 4,
    "partial_failed": 1,
}
STATUS_LABELS = {
    "queued": "排队中",
    "running": "运行中",
    "generated": "已完成",
    "completed": "已完成",
    "partial_failed": "部分完成",
    "failed": "失败",
    "error": "失败",
    "cancelled": "已取消",
}
SUMMARY_STAGE_LABELS = {
    "idle": "等待中",
    "queued": "排队中",
    "extracting_context": "提取全文",
    "chunking": "分块分析",
    "analyzing_structure": "分析结构",
    "generating_summary": "生成摘要",
    "checking_coverage": "校验结果",
    "completed": "已完成",
    "failed": "失败",
    "cancelled": "已取消",
}
TRANSLATION_STAGE_LABELS = {
    "idle": "等待中",
    "running": "全文翻译",
    "completed": "已完成",
    "partial_failed": "部分完成",
    "error": "失败",
    "cancelled": "已取消",
}


def _status_group(status: str) -> str:
    if status in ACTIVE_STATUSES:
        return "active"
    if status in FAILED_STATUSES:
        return "failed"
    if status in COMPLETED_STATUSES:
        return "completed"
    return "idle"


def _progress(completed: int, total: int) -> int:
    if total <= 0:
        return 0
    return max(0, min(100, round((completed / total) * 100)))


def _paper_title(paper: Paper | None) -> str:
    if not paper:
        return "目标文献"
    return (paper.title or paper.file_name or "目标文献").strip()


def _sort_key(item: TaskCenterItemResponse) -> tuple[int, float]:
    timestamp = item.updated_at or item.created_at
    sort_time = timestamp.timestamp() if timestamp else 0
    return (
        STATUS_PRIORITY.get(item.status, 9),
        -sort_time,
    )


def _add_status_counts(counts: dict[str, int], rows: list[tuple[str | None, int]]) -> None:
    for status, raw_count in rows:
        group = _status_group(str(status or "idle"))
        counts[group] = counts.get(group, 0) + int(raw_count or 0)


def _archive_join_condition(source_kind: str, source_id_column, user_id: int):
    return and_(
        TaskCenterArchive.user_id == user_id,
        TaskCenterArchive.source_kind == source_kind,
        TaskCenterArchive.source_id == source_id_column,
    )


def _build_task_center_summary(db: Session, user_id: int) -> TaskCenterSummaryResponse:
    counts: dict[str, int] = {"active": 0, "failed": 0, "completed": 0, "idle": 0}
    summary_rows = db.execute(
        select(PaperSummary.status, func.count(PaperSummary.id))
        .outerjoin(TaskCenterArchive, _archive_join_condition("paper_summary", PaperSummary.id, user_id))
        .where(
            PaperSummary.user_id == user_id,
            PaperSummary.status != "idle",
            TaskCenterArchive.id.is_(None),
        )
        .group_by(PaperSummary.status)
    ).all()
    matrix_rows = db.execute(
        select(ResearchMatrixRun.status, func.count(ResearchMatrixRun.id))
        .outerjoin(TaskCenterArchive, _archive_join_condition("research_matrix", ResearchMatrixRun.id, user_id))
        .where(ResearchMatrixRun.user_id == user_id, TaskCenterArchive.id.is_(None))
        .group_by(ResearchMatrixRun.status)
    ).all()
    translation_rows = []
    if settings.full_translation_enabled:
        translation_rows = db.execute(
            select(PaperFullTranslation.status, func.count(PaperFullTranslation.id))
            .join(Paper, Paper.id == PaperFullTranslation.paper_id)
            .outerjoin(TaskCenterArchive, _archive_join_condition("full_translation", PaperFullTranslation.id, user_id))
            .where(
                Paper.user_id == user_id,
                Paper.deleted_at.is_(None),
                PaperFullTranslation.status != "idle",
                TaskCenterArchive.id.is_(None),
            )
            .group_by(PaperFullTranslation.status)
        ).all()

    _add_status_counts(counts, summary_rows)
    _add_status_counts(counts, matrix_rows)
    _add_status_counts(counts, translation_rows)
    total_count = sum(counts.values())
    return TaskCenterSummaryResponse(
        active_count=counts.get("active", 0),
        failed_count=counts.get("failed", 0),
        completed_count=counts.get("completed", 0),
        total_count=total_count,
        attention_count=counts.get("active", 0) + counts.get("failed", 0),
    )


def _build_summary_task(item: PaperSummary) -> TaskCenterItemResponse:
    status = str(item.status or "idle")
    stage = str(item.stage or status or "idle")
    paper = item.paper
    summary_type = str(item.summary_type or "overview")
    title = f"{_paper_title(paper)} · {summary_title(summary_type) if summary_type in SUMMARY_TYPES else '摘要任务'}"
    return TaskCenterItemResponse(
        id=f"paper_summary:{item.id}",
        source_kind="paper_summary",
        source_id=int(item.id),
        status=status,
        status_group=_status_group(status),
        status_label=STATUS_LABELS.get(status, status),
        stage=stage,
        stage_label=SUMMARY_STAGE_LABELS.get(stage, stage),
        title=title,
        subtitle="单篇文献卡片",
        progress_percent=max(0, min(100, int(item.progress or 0))),
        error_message=item.error_message,
        action_kind="open-summary",
        action_payload={"paper_id": item.paper_id, "summary_type": summary_type},
        can_cancel=status in ACTIVE_STATUSES,
        can_retry=status in FAILED_STATUSES,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _build_matrix_task(run: ResearchMatrixRun) -> TaskCenterItemResponse:
    status = str(run.status or "queued")
    stage = str(run.stage or status or "idle")
    return TaskCenterItemResponse(
        id=f"research_matrix:{run.id}",
        source_kind="research_matrix",
        source_id=int(run.id),
        status=status,
        status_group=_status_group(status),
        status_label=STATUS_LABELS.get(status, status),
        stage=stage,
        stage_label=RUN_STAGE_LABELS.get(stage, stage),
        title=run.title or "文献矩阵",
        subtitle=f"{int(run.ready_count or 0)}/{int(run.total_count or run.paper_count or 0)} 篇就绪",
        progress_percent=max(0, min(100, int(run.progress_percent or 0))),
        error_message=run.error_message or run.last_worker_error,
        action_kind="open-matrix",
        action_payload={"run_id": run.id},
        can_cancel=status in ACTIVE_STATUSES,
        can_retry=status in FAILED_STATUSES,
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


def _build_translation_task(item: PaperFullTranslation) -> TaskCenterItemResponse:
    status = str(item.status or "idle")
    title = f"{_paper_title(item.paper)} · 全文翻译"
    return TaskCenterItemResponse(
        id=f"full_translation:{item.id}",
        source_kind="full_translation",
        source_id=int(item.id),
        status=status,
        status_group=_status_group(status),
        status_label=STATUS_LABELS.get(status, status),
        stage=status,
        stage_label=TRANSLATION_STAGE_LABELS.get(status, status),
        title=title,
        subtitle=f"{int(item.completed_units or 0)}/{int(item.total_units or 0)} 单元",
        progress_percent=100 if status == "completed" else _progress(int(item.completed_units or 0), int(item.total_units or 0)),
        error_message=item.error_message,
        action_kind="open-full-translation",
        action_payload={"paper_id": item.paper_id},
        can_cancel=status in ACTIVE_STATUSES,
        can_retry=status in FAILED_STATUSES,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _parse_task_id(task_id: str) -> tuple[str, int]:
    source_kind, _, raw_id = str(task_id or "").partition(":")
    if not source_kind or not raw_id:
        raise HTTPException(status_code=400, detail="任务编号无效。")
    try:
        source_id = int(raw_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="任务编号无效。") from exc
    return source_kind, source_id


def _load_summary_task(db: Session, source_id: int, user_id: int) -> PaperSummary:
    item = db.scalar(
        select(PaperSummary)
        .options(selectinload(PaperSummary.paper))
        .where(PaperSummary.id == source_id, PaperSummary.user_id == user_id)
    )
    if not item:
        raise HTTPException(status_code=404, detail="摘要任务不存在。")
    return item


def _load_matrix_task(db: Session, source_id: int, user_id: int) -> ResearchMatrixRun:
    run = db.scalar(
        select(ResearchMatrixRun)
        .options(selectinload(ResearchMatrixRun.papers))
        .where(ResearchMatrixRun.id == source_id, ResearchMatrixRun.user_id == user_id)
    )
    if not run:
        raise HTTPException(status_code=404, detail="文献矩阵任务不存在。")
    return run


def _load_translation_task(db: Session, source_id: int, user_id: int) -> PaperFullTranslation:
    item = db.scalar(
        select(PaperFullTranslation)
        .options(selectinload(PaperFullTranslation.paper))
        .join(Paper, Paper.id == PaperFullTranslation.paper_id)
        .where(
            PaperFullTranslation.id == source_id,
            Paper.user_id == user_id,
            Paper.deleted_at.is_(None),
        )
    )
    if not item:
        raise HTTPException(status_code=404, detail="全文翻译任务不存在。")
    return item


def _reset_translation_pages_for_retry(item: PaperFullTranslation, *, failed_only: bool = False) -> int:
    total_units = 0
    for page in item.pages_json or []:
        for block in page.get("blocks") or []:
            source_text = str(block.get("source_text") or "").strip()
            if not source_text:
                continue
            should_copy = block.get("translate_policy") == "copy" or block.get("status") == "copied"
            if should_copy:
                block["translate_policy"] = "copy"
                block["status"] = "copied"
                block["translated_text"] = block.get("translated_text") or block.get("source_text", "")
                continue
            if failed_only and block.get("status") == "translated" and str(block.get("translated_text") or "").strip():
                block["translate_policy"] = "translate"
                continue
            block["status"] = "pending"
            block["translated_text"] = ""
            total_units += 1
    return total_units


def _unique_task_ids(task_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw_id in task_ids or []:
        task_id = str(raw_id or "").strip()
        if not task_id or task_id in seen:
            continue
        seen.add(task_id)
        result.append(task_id)
        if len(result) >= 200:
            break
    return result


def _build_task_item_by_id(db: Session, user_id: int, task_id: str) -> TaskCenterItemResponse | None:
    try:
        source_kind, source_id = _parse_task_id(task_id)
    except HTTPException:
        return None

    try:
        if source_kind == "paper_summary":
            return _build_summary_task(_load_summary_task(db, source_id, user_id))
        if source_kind == "research_matrix":
            return _build_matrix_task(_load_matrix_task(db, source_id, user_id))
        if source_kind == "full_translation" and settings.full_translation_enabled:
            return _build_translation_task(_load_translation_task(db, source_id, user_id))
    except HTTPException as exc:
        if exc.status_code == 404:
            return None
        raise
    return None


def _archive_completed_task_ids(
    db: Session,
    user_id: int,
    task_ids: list[str],
) -> tuple[list[str], list[str]]:
    unique_ids = _unique_task_ids(task_ids)
    if not unique_ids:
        return [], []

    existing_ids = set(
        db.scalars(
            select(TaskCenterArchive.task_id).where(
                TaskCenterArchive.user_id == user_id,
                TaskCenterArchive.task_id.in_(unique_ids),
            )
        ).all()
    )

    archived_ids: list[str] = []
    skipped_ids: list[str] = []
    for task_id in unique_ids:
        task_item = _build_task_item_by_id(db, user_id, task_id)
        if not task_item or task_item.status_group != "completed":
            skipped_ids.append(task_id)
            continue
        archived_ids.append(task_id)
        if task_id in existing_ids:
            continue
        db.add(
            TaskCenterArchive(
                user_id=user_id,
                task_id=task_id,
                source_kind=task_item.source_kind,
                source_id=task_item.source_id,
            )
        )
    db.commit()
    return archived_ids, skipped_ids


def _load_completed_task_ids_for_user(db: Session, user_id: int) -> list[str]:
    summary_ids = db.scalars(
        select(PaperSummary.id)
        .outerjoin(TaskCenterArchive, _archive_join_condition("paper_summary", PaperSummary.id, user_id))
        .where(
            PaperSummary.user_id == user_id,
            PaperSummary.status.in_(COMPLETED_STATUSES),
            TaskCenterArchive.id.is_(None),
        )
        .limit(200)
    ).all()
    matrix_ids = db.scalars(
        select(ResearchMatrixRun.id)
        .outerjoin(TaskCenterArchive, _archive_join_condition("research_matrix", ResearchMatrixRun.id, user_id))
        .where(
            ResearchMatrixRun.user_id == user_id,
            ResearchMatrixRun.status.in_(COMPLETED_STATUSES),
            TaskCenterArchive.id.is_(None),
        )
        .limit(200)
    ).all()
    translation_ids = []
    if settings.full_translation_enabled:
        translation_ids = db.scalars(
            select(PaperFullTranslation.id)
            .join(Paper, Paper.id == PaperFullTranslation.paper_id)
            .outerjoin(TaskCenterArchive, _archive_join_condition("full_translation", PaperFullTranslation.id, user_id))
            .where(
                Paper.user_id == user_id,
                Paper.deleted_at.is_(None),
                PaperFullTranslation.status.in_(COMPLETED_STATUSES),
                TaskCenterArchive.id.is_(None),
            )
            .limit(200)
        ).all()
    task_ids = [f"paper_summary:{item_id}" for item_id in summary_ids]
    task_ids.extend(f"research_matrix:{item_id}" for item_id in matrix_ids)
    task_ids.extend(f"full_translation:{item_id}" for item_id in translation_ids)
    return task_ids[:200]


@router.post("/{task_id}/cancel", response_model=TaskCenterItemResponse)
def cancel_task(
    task_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> TaskCenterItemResponse:
    source_kind, source_id = _parse_task_id(task_id)
    if source_kind == "paper_summary":
        item = _load_summary_task(db, source_id, current_user.id)
        if item.status in ACTIVE_STATUSES:
            item.status = "cancelled"
            item.stage = "cancelled"
            item.error_message = "已取消摘要生成。"
            db.add(item)
            db.commit()
            db.refresh(item)
            _start_next_queued_summary_if_possible(db)
        return _build_summary_task(item)

    if source_kind == "research_matrix":
        run = _load_matrix_task(db, source_id, current_user.id)
        if run.status in ACTIVE_STATUSES:
            run.status = "cancelled"
            run.stage = "cancelled"
            run.worker_status = "cancelled"
            run.worker_pid = None
            run.error_message = "已取消文献矩阵生成。"
            db.add(run)
            db.commit()
            db.refresh(run)
            _start_next_queued_matrix_run_if_possible(db)
        return _build_matrix_task(run)

    if source_kind == "full_translation":
        if not settings.full_translation_enabled:
            raise HTTPException(status_code=404, detail="全文翻译功能已暂停。")
        item = _load_translation_task(db, source_id, current_user.id)
        if item.status in ACTIVE_STATUSES:
            item.status = "cancelled"
            item.error_message = "已取消全文翻译。"
            db.add(item)
            db.commit()
            db.refresh(item)
        return _build_translation_task(item)

    raise HTTPException(status_code=400, detail="不支持的任务类型。")


@router.post("/{task_id}/retry", response_model=TaskCenterItemResponse)
def retry_task(
    task_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> TaskCenterItemResponse:
    source_kind, source_id = _parse_task_id(task_id)
    if source_kind == "paper_summary":
        item = _load_summary_task(db, source_id, current_user.id)
        if item.status not in FAILED_STATUSES:
            raise HTTPException(status_code=409, detail="当前摘要任务不需要重试。")
        start_now = should_start_summary_immediately(db, current_user.id)
        item.status = "running" if start_now else "queued"
        item.stage = "extracting_context" if start_now else "queued"
        item.progress = 3 if start_now else 0
        item.error_message = None
        db.add(item)
        db.commit()
        db.refresh(item)
        if start_now:
            try:
                spawn_paper_summary_worker(item.id, item.provider_id)
            except Exception as exc:
                item.status = "failed"
                item.stage = "failed"
                item.error_message = f"启动摘要 worker 失败：{exc}"
                db.add(item)
                db.commit()
                db.refresh(item)
        return _build_summary_task(item)

    if source_kind == "research_matrix":
        run = _load_matrix_task(db, source_id, current_user.id)
        if run.status not in FAILED_STATUSES:
            raise HTTPException(status_code=409, detail="当前文献矩阵任务不需要重试。")
        run = retry_pending_run(db, run)
        run = _ensure_matrix_worker_started(db, run, None)
        return _build_matrix_task(run)

    if source_kind == "full_translation":
        if not settings.full_translation_enabled:
            raise HTTPException(status_code=404, detail="全文翻译功能已暂停。")
        item = _load_translation_task(db, source_id, current_user.id)
        if item.status not in FAILED_STATUSES:
            raise HTTPException(status_code=409, detail="当前全文翻译任务不需要重试。")
        if not item.pages_json:
            raise HTTPException(status_code=409, detail="缺少上一次解析结果，请回到论文页重新开始全文翻译。")
        total_units = _reset_translation_pages_for_retry(item, failed_only=item.status == "partial_failed")
        if total_units <= 0:
            raise HTTPException(status_code=409, detail="没有可翻译的正文内容。")
        item.status = "running"
        item.completed_units = 0
        item.total_units = total_units
        item.error_message = None
        flag_modified(item, "pages_json")
        db.add(item)
        db.commit()
        db.refresh(item)
        try:
            spawn_full_translation_worker_process(item.id, item.provider_id)
        except Exception as exc:
            item.status = "error"
            item.error_message = f"启动全文翻译 worker 失败：{exc}"
            db.add(item)
            db.commit()
            db.refresh(item)
        return _build_translation_task(item)

    raise HTTPException(status_code=400, detail="不支持的任务类型。")


@router.post("/archive", response_model=TaskCenterArchiveResponse)
def archive_task_center_items(
    payload: TaskCenterArchiveRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> TaskCenterArchiveResponse:
    archived_ids, skipped_ids = _archive_completed_task_ids(db, current_user.id, payload.task_ids)
    return TaskCenterArchiveResponse(
        archived_ids=archived_ids,
        archived_count=len(archived_ids),
        skipped_ids=skipped_ids,
        summary=_build_task_center_summary(db, current_user.id),
    )


@router.post("/archive-completed", response_model=TaskCenterArchiveResponse)
def archive_completed_task_center_items(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> TaskCenterArchiveResponse:
    completed_task_ids = _load_completed_task_ids_for_user(db, current_user.id)
    archived_ids, skipped_ids = _archive_completed_task_ids(db, current_user.id, completed_task_ids)
    return TaskCenterArchiveResponse(
        archived_ids=archived_ids,
        archived_count=len(archived_ids),
        skipped_ids=skipped_ids,
        summary=_build_task_center_summary(db, current_user.id),
    )


@router.get("/summary", response_model=TaskCenterSummaryResponse)
def get_task_center_summary(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> TaskCenterSummaryResponse:
    normalize_stale_tasks(db, current_user.id)
    return _build_task_center_summary(db, current_user.id)


@router.get("", response_model=TaskCenterResponse)
def get_task_center(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> TaskCenterResponse:
    normalize_stale_tasks(db, current_user.id)
    summary_rows = db.scalars(
        select(PaperSummary)
        .options(selectinload(PaperSummary.paper))
        .outerjoin(TaskCenterArchive, _archive_join_condition("paper_summary", PaperSummary.id, current_user.id))
        .where(
            PaperSummary.user_id == current_user.id,
            PaperSummary.status != "idle",
            TaskCenterArchive.id.is_(None),
        )
        .order_by(PaperSummary.updated_at.desc(), PaperSummary.id.desc())
        .limit(80)
    ).all()
    matrix_rows = db.scalars(
        select(ResearchMatrixRun)
        .options(
            load_only(
                ResearchMatrixRun.id,
                ResearchMatrixRun.title,
                ResearchMatrixRun.status,
                ResearchMatrixRun.stage,
                ResearchMatrixRun.paper_count,
                ResearchMatrixRun.total_count,
                ResearchMatrixRun.ready_count,
                ResearchMatrixRun.failed_count,
                ResearchMatrixRun.progress_percent,
                ResearchMatrixRun.worker_status,
                ResearchMatrixRun.worker_started_at,
                ResearchMatrixRun.worker_heartbeat_at,
                ResearchMatrixRun.worker_pid,
                ResearchMatrixRun.worker_retry_count,
                ResearchMatrixRun.last_worker_error,
                ResearchMatrixRun.error_message,
                ResearchMatrixRun.created_at,
                ResearchMatrixRun.updated_at,
            )
        )
        .outerjoin(TaskCenterArchive, _archive_join_condition("research_matrix", ResearchMatrixRun.id, current_user.id))
        .where(ResearchMatrixRun.user_id == current_user.id, TaskCenterArchive.id.is_(None))
        .order_by(ResearchMatrixRun.created_at.desc(), ResearchMatrixRun.id.desc())
        .limit(50)
    ).all()
    translation_rows = []
    if settings.full_translation_enabled:
        translation_rows = db.scalars(
            select(PaperFullTranslation)
            .options(selectinload(PaperFullTranslation.paper))
            .join(Paper, Paper.id == PaperFullTranslation.paper_id)
            .outerjoin(TaskCenterArchive, _archive_join_condition("full_translation", PaperFullTranslation.id, current_user.id))
            .where(
                Paper.user_id == current_user.id,
                Paper.deleted_at.is_(None),
                PaperFullTranslation.status != "idle",
                TaskCenterArchive.id.is_(None),
            )
            .order_by(PaperFullTranslation.updated_at.desc(), PaperFullTranslation.id.desc())
            .limit(40)
        ).all()

    items: list[TaskCenterItemResponse] = []
    items.extend(_build_summary_task(item) for item in summary_rows)
    for run in matrix_rows:
        normalized = normalize_run_runtime_state(db, run)
        items.append(_build_matrix_task(normalized))
    items.extend(_build_translation_task(item) for item in translation_rows)

    items.sort(key=_sort_key)
    items = items[:limit]
    return TaskCenterResponse(summary=_build_task_center_summary(db, current_user.id), items=items)
