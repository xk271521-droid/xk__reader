from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Paper, PaperFullTranslation


FULL_TRANSLATION_RUNNING_STALE_SECONDS = 30 * 60
RECENT_FAILURE_LIMIT = 8


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _status_count_map(rows: list[tuple[str | None, int]]) -> dict[str, int]:
    return {str(status or "idle"): int(total or 0) for status, total in rows}


def _recent_failed_translations(db: Session) -> list[dict[str, Any]]:
    if not settings.full_translation_enabled:
        return []

    rows = db.execute(
        select(PaperFullTranslation, Paper)
        .join(Paper, Paper.id == PaperFullTranslation.paper_id)
        .where(
            PaperFullTranslation.status.in_(("error", "partial_failed", "cancelled")),
            Paper.deleted_at.is_(None),
        )
        .order_by(PaperFullTranslation.updated_at.desc())
        .limit(RECENT_FAILURE_LIMIT)
    ).all()
    return [
        {
            "id": f"full_translation:{item.id}",
            "source_kind": "full_translation",
            "status": item.status,
            "title": (paper.title or paper.file_name or "未命名文献").strip(),
            "error_message": " ".join(str(item.error_message or "未记录错误原因").split()),
            "updated_at": (item.updated_at or item.created_at).isoformat()
            if (item.updated_at or item.created_at)
            else None,
        }
        for item, paper in rows
    ]


def normalize_stale_tasks(db: Session, user_id: int | None = None) -> dict[str, int]:
    """Keep the remaining translation task state recoverable after a restart."""
    recovered = {"translations_interrupted": 0}
    if not settings.full_translation_enabled:
        return recovered

    stale_before = _utcnow_naive() - timedelta(seconds=FULL_TRANSLATION_RUNNING_STALE_SECONDS)
    query = (
        select(PaperFullTranslation)
        .join(Paper, Paper.id == PaperFullTranslation.paper_id)
        .where(
            PaperFullTranslation.status == "running",
            PaperFullTranslation.updated_at < stale_before,
            Paper.deleted_at.is_(None),
        )
    )
    if user_id is not None:
        query = query.where(Paper.user_id == user_id)

    stale_translations = db.scalars(query.limit(40)).all()
    for item in stale_translations:
        # A stalled retranslation must not hide a usable cached PDF.  The
        # response exposes the artifact independently from task status, but
        # keeping this row completed also prevents an automatic repeat run.
        if item.artifact_path:
            item.status = "completed"
            item.error_message = "重新翻译任务长时间没有进度，已保留上一版译文；如需更新请手动重新翻译。"
        else:
            item.status = "error"
            item.error_message = "全文翻译任务长时间没有进度，已转为可重试状态。"
        db.add(item)
        recovered["translations_interrupted"] += 1
    if stale_translations:
        db.commit()
    return recovered


def build_task_health_snapshot(db: Session) -> dict[str, Any]:
    recovered = normalize_stale_tasks(db)
    translation_counts: dict[str, int] = {}
    if settings.full_translation_enabled:
        translation_counts = _status_count_map(
            db.execute(
                select(PaperFullTranslation.status, func.count(PaperFullTranslation.id)).group_by(
                    PaperFullTranslation.status
                )
            ).all()
        )

    active = translation_counts.get("running", 0)
    failed = sum(
        translation_counts.get(status, 0)
        for status in ("error", "partial_failed", "cancelled")
    )
    completed = translation_counts.get("completed", 0)
    return {
        "status": "degraded" if failed else "ok",
        "recovered": recovered,
        "totals": {"active": active, "failed": failed, "completed": completed},
        "recent_failures": _recent_failed_translations(db),
        **({"full_translations": translation_counts} if settings.full_translation_enabled else {}),
    }
