"""Aggregate durable background jobs for the user-facing task center."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Paper,
    PaperAiOutline,
    PaperFullTranslation,
    PaperReadingBrief,
    TaskCenterArchive,
)
from app.services.paper_ai_outline import mark_running_ai_outline_stale
from app.services.paper_reading_brief import mark_running_brief_stale
from app.services.task_monitor import normalize_stale_tasks


_ACTIVE_STATUSES = {"queued", "running"}
_FAILED_STATUSES = {"failed", "error", "partial_failed", "cancelled"}
_FINISHED_GROUPS = {"failed", "completed"}
_STATUS_LABELS = {
    "queued": "排队中",
    "running": "进行中",
    "completed": "已完成",
    "failed": "异常",
    "error": "异常",
    "partial_failed": "部分失败",
    "cancelled": "已取消",
}
_STAGE_LABELS = {
    "queued": "等待后台处理",
    "extracting_full_text": "提取论文正文",
    "generating_brief": "生成文献速读",
    "checking_coverage": "校验速读内容",
    "preparing_native_titles": "准备原生目录",
    "translating_native_titles": "翻译目录标题",
    "generating_outline": "生成 AI 目录",
    "checking_native_titles": "校验目录翻译",
    "checking_page_references": "校验目录页码",
    "running": "后台处理中",
    "completed": "已完成",
    "failed": "处理失败",
}
_SOURCE_LABELS = {
    "full_translation": "全文翻译",
    "reading_brief": "文献速读",
    "ai_outline": "AI 目录",
}


def normalize_task_center_states(db: Session, user_id: int) -> None:
    """Turn interrupted durable jobs into retryable failures before listing them."""
    normalize_stale_tasks(db, user_id)
    changed = False
    brief_items = db.scalars(
        select(PaperReadingBrief)
        .join(Paper, Paper.id == PaperReadingBrief.paper_id)
        .where(PaperReadingBrief.user_id == user_id, Paper.deleted_at.is_(None))
    ).all()
    outline_items = db.scalars(
        select(PaperAiOutline)
        .join(Paper, Paper.id == PaperAiOutline.paper_id)
        .where(PaperAiOutline.user_id == user_id, Paper.deleted_at.is_(None))
    ).all()
    for item in (*brief_items, *outline_items):
        if isinstance(item, PaperReadingBrief):
            changed = mark_running_brief_stale(item) or changed
        else:
            changed = mark_running_ai_outline_stale(item) or changed
    if changed:
        db.commit()


def _status_group(status: str) -> str:
    if status in _ACTIVE_STATUSES:
        return "active"
    if status == "completed":
        return "completed"
    return "failed" if status in _FAILED_STATUSES else "idle"


def _task_title(paper: Paper) -> str:
    return (paper.title or paper.file_name or "未命名文献").strip()


def _task_subtitle(paper: Paper, title: str) -> str:
    file_name = (paper.file_name or "").strip()
    return "" if not file_name or file_name == title else file_name


def _stage_label(stage: str, status: str) -> str:
    return _STAGE_LABELS.get(stage) or _STATUS_LABELS.get(status) or "等待处理"


def _progress(value: int | float | None, status: str) -> int:
    if status == "completed":
        return 100
    return max(0, min(100, int(value or 0)))


def _entry(
    *,
    source_kind: str,
    source_id: int,
    paper: Paper,
    status: str,
    stage: str,
    progress: int | float | None,
    error_message: str | None,
    created_at: datetime | None,
    updated_at: datetime | None,
    can_cancel: bool = False,
    action_payload: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    normalized_status = str(status or "idle")
    status_group = _status_group(normalized_status)
    if status_group == "idle":
        return None
    title = _task_title(paper)
    return {
        "id": f"{source_kind}:{source_id}",
        "source_kind": source_kind,
        "source_id": source_id,
        "status": normalized_status,
        "status_group": status_group,
        "status_label": _STATUS_LABELS.get(normalized_status, "待处理"),
        "stage": stage or normalized_status,
        "stage_label": _stage_label(stage, normalized_status),
        "title": title,
        "subtitle": _task_subtitle(paper, title),
        "progress_percent": _progress(progress, normalized_status),
        "error_message": " ".join(str(error_message or "").split()) or None,
        "action_kind": f"open-{source_kind.replace('_', '-')}",
        "action_payload": {"paper_id": paper.id, **(action_payload or {})},
        "can_cancel": can_cancel and normalized_status == "running",
        "can_retry": status_group == "failed",
        "created_at": created_at,
        "updated_at": updated_at,
    }


def _collect_task_entries(db: Session, user_id: int) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    translations = db.execute(
        select(PaperFullTranslation, Paper)
        .join(Paper, Paper.id == PaperFullTranslation.paper_id)
        .where(Paper.user_id == user_id, Paper.deleted_at.is_(None))
    ).all()
    for item, paper in translations:
        total_units = max(1, int(item.total_units or 0))
        entry = _entry(
            source_kind="full_translation",
            source_id=item.id,
            paper=paper,
            status=item.status,
            stage=item.status,
            progress=round(100 * int(item.completed_units or 0) / total_units),
            error_message=item.error_message,
            created_at=item.created_at,
            updated_at=item.updated_at,
            can_cancel=True,
        )
        if entry:
            entries.append(entry)

    briefs = db.execute(
        select(PaperReadingBrief, Paper)
        .join(Paper, Paper.id == PaperReadingBrief.paper_id)
        .where(PaperReadingBrief.user_id == user_id, Paper.deleted_at.is_(None))
    ).all()
    for item, paper in briefs:
        entry = _entry(
            source_kind="reading_brief",
            source_id=item.id,
            paper=paper,
            status=item.status,
            stage=item.stage,
            progress=item.progress,
            error_message=item.error_message,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        if entry:
            entries.append(entry)

    outlines = db.execute(
        select(PaperAiOutline, Paper)
        .join(Paper, Paper.id == PaperAiOutline.paper_id)
        .where(PaperAiOutline.user_id == user_id, Paper.deleted_at.is_(None))
    ).all()
    for item, paper in outlines:
        entry = _entry(
            source_kind="ai_outline",
            source_id=item.id,
            paper=paper,
            status=item.status,
            stage=item.stage,
            progress=item.progress,
            error_message=item.error_message,
            created_at=item.created_at,
            updated_at=item.updated_at,
            action_payload={
                "native_outline": {
                    "items": (item.content_json or {}).get("_native_outline", []),
                }
            },
        )
        if entry:
            entries.append(entry)
    return entries


def _archive_hidden_ids(db: Session, user_id: int) -> set[str]:
    return set(
        db.scalars(
            select(TaskCenterArchive.task_id).where(TaskCenterArchive.user_id == user_id)
        ).all()
    )


def _visible_entries(entries: Iterable[dict[str, Any]], archived_ids: set[str]) -> list[dict[str, Any]]:
    # A restarted job must become visible again even if its previous finished
    # record was cleared; otherwise a running task could silently disappear.
    return [
        item
        for item in entries
        if item["status_group"] not in _FINISHED_GROUPS or item["id"] not in archived_ids
    ]


def _sort_entries(entries: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    priority = {"active": 0, "failed": 1, "completed": 2}

    def key(item: dict[str, Any]) -> tuple[int, float]:
        updated_at = item.get("updated_at") or item.get("created_at")
        timestamp = updated_at.timestamp() if isinstance(updated_at, datetime) else 0.0
        return priority.get(str(item.get("status_group")), 3), -timestamp

    return sorted(entries, key=key)


def build_task_center_payload(db: Session, user_id: int, *, limit: int = 50) -> dict[str, Any]:
    normalize_task_center_states(db, user_id)
    entries = _visible_entries(_collect_task_entries(db, user_id), _archive_hidden_ids(db, user_id))
    ordered_entries = _sort_entries(entries)
    summary = {
        "active_count": sum(item["status_group"] == "active" for item in ordered_entries),
        "failed_count": sum(item["status_group"] == "failed" for item in ordered_entries),
        "completed_count": sum(item["status_group"] == "completed" for item in ordered_entries),
    }
    summary["total_count"] = len(ordered_entries)
    summary["attention_count"] = summary["active_count"] + summary["failed_count"]
    return {"summary": summary, "items": ordered_entries[:limit]}


def find_task_entry(db: Session, user_id: int, task_id: str) -> dict[str, Any] | None:
    normalize_task_center_states(db, user_id)
    return next((item for item in _collect_task_entries(db, user_id) if item["id"] == task_id), None)


def finished_task_ids(db: Session, user_id: int) -> list[str]:
    normalize_task_center_states(db, user_id)
    entries = _visible_entries(_collect_task_entries(db, user_id), _archive_hidden_ids(db, user_id))
    return [item["id"] for item in _sort_entries(entries) if item["status_group"] in _FINISHED_GROUPS]


def archive_task_entries(db: Session, user_id: int, task_ids: Iterable[str]) -> tuple[list[str], list[str]]:
    normalize_task_center_states(db, user_id)
    entries = {item["id"]: item for item in _collect_task_entries(db, user_id)}
    existing_ids = _archive_hidden_ids(db, user_id)
    archived_ids: list[str] = []
    skipped_ids: list[str] = []
    for task_id in dict.fromkeys(str(value) for value in task_ids):
        entry = entries.get(task_id)
        if not entry or entry["status_group"] not in _FINISHED_GROUPS:
            skipped_ids.append(task_id)
            continue
        if task_id not in existing_ids:
            db.add(
                TaskCenterArchive(
                    user_id=user_id,
                    task_id=task_id,
                    source_kind=entry["source_kind"],
                    source_id=entry["source_id"],
                )
            )
        archived_ids.append(task_id)
    if archived_ids:
        db.commit()
    return archived_ids, skipped_ids


def task_source_label(source_kind: str) -> str:
    return _SOURCE_LABELS.get(source_kind, "后台任务")
