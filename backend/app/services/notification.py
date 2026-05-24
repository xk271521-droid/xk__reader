from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Notification, User


def compact_notification_text(value: Any, limit: int = 120) -> str:
    text = " ".join(str(value or "").split()).strip()
    if not text:
        return ""
    return text if len(text) <= limit else f"{text[: max(0, limit - 3)].rstrip()}..."


def visible_notification_filters(user_id: int) -> tuple:
    filters = [Notification.user_id == user_id]
    if not settings.full_translation_enabled:
        filters.append(Notification.source_kind != "full_translation")
    return tuple(filters)


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
    unread_count = get_unread_notification_count(db, user_id)
    latest = db.execute(
        select(Notification.id, Notification.created_at)
        .where(*visible_notification_filters(user_id))
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(1)
    ).first()
    return {
        "unread_count": unread_count,
        "latest_notification_id": latest[0] if latest else None,
        "latest_created_at": latest[1] if latest else None,
    }


def get_unread_notification_count(db: Session, user_id: int) -> int:
    return int(
        db.scalar(
            select(func.count(Notification.id)).where(
                *visible_notification_filters(user_id),
                Notification.read_at.is_(None),
            )
        ) or 0
    )


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


def delete_notification(db: Session, notification: Notification) -> None:
    db.delete(notification)
    db.commit()


def clear_all_notifications(db: Session, user_id: int) -> int:
    result = db.execute(
        delete(Notification)
        .where(Notification.user_id == user_id)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    return int(result.rowcount or 0)


def broadcast_admin_notification(
    db: Session,
    *,
    title: str,
    message: str,
    actor_user_id: int,
) -> int:
    user_ids = [int(user_id) for user_id in db.scalars(select(User.id)).all()]
    if not user_ids:
        return 0

    title_text = compact_notification_text(title, 160)
    message_text = compact_notification_text(message, 320)
    for start in range(0, len(user_ids), 500):
        db.bulk_save_objects(
            [
                Notification(
                    user_id=user_id,
                    source_kind="admin_broadcast",
                    source_id=int(actor_user_id),
                    event_kind="broadcast",
                    title=title_text,
                    message=message_text,
                    action_kind="none",
                    action_payload={},
                )
                for user_id in user_ids[start : start + 500]
            ]
        )

    db.commit()
    return len(user_ids)
