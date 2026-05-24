from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Paper, PaperFullTranslation, PaperSummary, ResearchMatrixRun
from app.services.paper_summary import (
    _start_next_queued_summary_if_possible,
    is_summary_running_stale,
    mark_summary_interrupted,
)
from app.services.research_matrix import normalize_run_runtime_state

FULL_TRANSLATION_RUNNING_STALE_SECONDS = 30 * 60
RECENT_FAILURE_LIMIT = 8


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _status_count_map(rows: list[tuple[str | None, int]]) -> dict[str, int]:
    return {str(status or "idle"): int(total or 0) for status, total in rows}


def _iso_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _clip_failure_message(value: str | None, limit: int = 260) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return "未记录错误原因。"
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def _paper_display_title(paper: Paper | None) -> str:
    if not paper:
        return "未命名文献"
    return (paper.title or paper.file_name or "未命名文献").strip() or "未命名文献"


def _recent_failed_tasks(db: Session) -> list[dict[str, Any]]:
    failures: list[dict[str, Any]] = []

    summary_rows = db.execute(
        select(PaperSummary, Paper)
        .join(Paper, Paper.id == PaperSummary.paper_id)
        .where(PaperSummary.status == "failed", Paper.deleted_at.is_(None))
        .order_by(PaperSummary.updated_at.desc())
        .limit(RECENT_FAILURE_LIMIT)
    ).all()
    for item, paper in summary_rows:
        failures.append({
            "id": f"paper_summary:{item.id}",
            "source_kind": "paper_summary",
            "label": "摘要任务",
            "status": item.status,
            "title": _paper_display_title(paper),
            "subtitle": item.summary_type or "summary",
            "error_message": _clip_failure_message(item.error_message),
            "updated_at": _iso_datetime(item.updated_at or item.created_at),
        })

    matrix_rows = db.scalars(
        select(ResearchMatrixRun)
        .where(ResearchMatrixRun.status == "failed")
        .order_by(ResearchMatrixRun.updated_at.desc())
        .limit(RECENT_FAILURE_LIMIT)
    ).all()
    for run in matrix_rows:
        failures.append({
            "id": f"research_matrix:{run.id}",
            "source_kind": "research_matrix",
            "label": "文献矩阵",
            "status": run.status,
            "title": run.title or f"矩阵批次 #{run.id}",
            "subtitle": f"{run.ready_count or 0}/{run.total_count or run.paper_count or 0} 篇已准备",
            "error_message": _clip_failure_message(run.error_message or run.last_worker_error),
            "updated_at": _iso_datetime(run.updated_at or run.created_at),
        })

    if settings.full_translation_enabled:
        translation_rows = db.execute(
            select(PaperFullTranslation, Paper)
            .join(Paper, Paper.id == PaperFullTranslation.paper_id)
            .where(
                PaperFullTranslation.status.in_(("error", "partial_failed", "cancelled")),
                Paper.deleted_at.is_(None),
            )
            .order_by(PaperFullTranslation.updated_at.desc())
            .limit(RECENT_FAILURE_LIMIT)
        ).all()
        for item, paper in translation_rows:
            failures.append({
                "id": f"full_translation:{item.id}",
                "source_kind": "full_translation",
                "label": "全文翻译",
                "status": item.status,
                "title": _paper_display_title(paper),
                "subtitle": f"{item.completed_units or 0}/{item.total_units or 0} 单元",
                "error_message": _clip_failure_message(item.error_message),
                "updated_at": _iso_datetime(item.updated_at or item.created_at),
            })

    return sorted(
        failures,
        key=lambda item: item.get("updated_at") or "",
        reverse=True,
    )[:RECENT_FAILURE_LIMIT]


def normalize_stale_tasks(db: Session, user_id: int | None = None) -> dict[str, int]:
    recovered = {
        "summaries_interrupted": 0,
        "matrix_requeued": 0,
        "translations_interrupted": 0,
    }

    summary_query = select(PaperSummary).where(PaperSummary.status == "running")
    if user_id is not None:
        summary_query = summary_query.where(PaperSummary.user_id == user_id)
    stale_summaries = db.scalars(summary_query.limit(40)).all()
    summary_changed = False
    for item in stale_summaries:
        if not is_summary_running_stale(item):
            continue
        mark_summary_interrupted(db, item)
        recovered["summaries_interrupted"] += 1
        summary_changed = True
    if summary_changed:
        _start_next_queued_summary_if_possible(db)

    matrix_query = select(ResearchMatrixRun).where(ResearchMatrixRun.status.in_(("queued", "running")))
    if user_id is not None:
        matrix_query = matrix_query.where(ResearchMatrixRun.user_id == user_id)
    matrix_runs = db.scalars(matrix_query.limit(40)).all()
    for run in matrix_runs:
        before = (run.status, run.stage, run.worker_status, run.worker_retry_count)
        normalized = normalize_run_runtime_state(db, run)
        after = (
            normalized.status,
            normalized.stage,
            normalized.worker_status,
            normalized.worker_retry_count,
        )
        if before != after:
            recovered["matrix_requeued"] += 1

    if settings.full_translation_enabled:
        stale_before = _utcnow_naive() - timedelta(seconds=FULL_TRANSLATION_RUNNING_STALE_SECONDS)
        translation_query = (
            select(PaperFullTranslation)
            .join(Paper, Paper.id == PaperFullTranslation.paper_id)
            .where(
                PaperFullTranslation.status == "running",
                PaperFullTranslation.updated_at < stale_before,
                Paper.deleted_at.is_(None),
            )
        )
        if user_id is not None:
            translation_query = translation_query.where(Paper.user_id == user_id)
        stale_translations = db.scalars(translation_query.limit(40)).all()
        for item in stale_translations:
            item.status = "error"
            item.error_message = "全文翻译任务长时间没有进度，已转为可重试状态。"
            db.add(item)
            recovered["translations_interrupted"] += 1
        if stale_translations:
            db.commit()

    return recovered


def build_task_health_snapshot(db: Session) -> dict[str, Any]:
    recovered = normalize_stale_tasks(db)
    summary_counts = _status_count_map(
        db.execute(
            select(PaperSummary.status, func.count(PaperSummary.id)).group_by(PaperSummary.status)
        ).all()
    )
    matrix_counts = _status_count_map(
        db.execute(
            select(ResearchMatrixRun.status, func.count(ResearchMatrixRun.id)).group_by(ResearchMatrixRun.status)
        ).all()
    )
    translation_counts = {}
    if settings.full_translation_enabled:
        translation_counts = _status_count_map(
            db.execute(
                select(PaperFullTranslation.status, func.count(PaperFullTranslation.id)).group_by(PaperFullTranslation.status)
            ).all()
        )

    active = (
        summary_counts.get("queued", 0)
        + summary_counts.get("running", 0)
        + matrix_counts.get("queued", 0)
        + matrix_counts.get("running", 0)
        + translation_counts.get("running", 0)
    )
    failed = (
        summary_counts.get("failed", 0)
        + matrix_counts.get("failed", 0)
        + translation_counts.get("error", 0)
        + translation_counts.get("partial_failed", 0)
        + translation_counts.get("cancelled", 0)
    )
    completed = (
        summary_counts.get("generated", 0)
        + matrix_counts.get("completed", 0)
        + translation_counts.get("completed", 0)
    )

    return {
        "status": "degraded" if failed else "ok",
        "recovered": recovered,
        "totals": {
            "active": active,
            "failed": failed,
            "completed": completed,
        },
        "paper_summaries": summary_counts,
        "research_matrix_runs": matrix_counts,
        "recent_failures": _recent_failed_tasks(db),
        **({"full_translations": translation_counts} if settings.full_translation_enabled else {}),
    }
