from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import Notification


def compact_notification_text(value: Any, limit: int = 120) -> str:
    text = " ".join(str(value or "").split()).strip()
    if not text:
        return ""
    return text if len(text) <= limit else f"{text[: max(0, limit - 3)].rstrip()}..."


def create_notification(
    db: Session,
    *,
    user_id: int,
    source_kind: str,
    source_id: int,
    event_kind: str,
    title: str,
    message: str,
    action_kind: str,
    action_payload: dict[str, Any] | None = None,
) -> Notification:
    item = Notification(
        user_id=user_id,
        source_kind=source_kind,
        source_id=source_id,
        event_kind=event_kind,
        title=compact_notification_text(title, 160),
        message=compact_notification_text(message, 320),
        action_kind=action_kind,
        action_payload=dict(action_payload or {}),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def get_notification_summary(db: Session, user_id: int) -> dict[str, Any]:
    unread_count = int(
        db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user_id,
                Notification.read_at.is_(None),
            )
        ) or 0
    )
    latest = db.scalar(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(1)
    )
    return {
        "unread_count": unread_count,
        "latest_notification_id": latest.id if latest else None,
        "latest_created_at": latest.created_at if latest else None,
    }


def mark_notification_read(db: Session, notification: Notification) -> Notification:
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        db.add(notification)
        db.commit()
        db.refresh(notification)
    return notification


def mark_all_notifications_read(db: Session, user_id: int) -> int:
    now = datetime.now(timezone.utc)
    result = db.execute(
        update(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.read_at.is_(None),
        )
        .values(read_at=now)
    )
    db.commit()
    return int(result.rowcount or 0)
