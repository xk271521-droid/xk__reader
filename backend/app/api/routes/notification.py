from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_current_user
from app.db.session import get_db
from app.models import Notification, User
from app.schemas.notification import (
    AdminBroadcastNotificationRequest,
    AdminBroadcastNotificationResponse,
    NotificationClearAllResponse,
    NotificationDeleteResponse,
    NotificationItemResponse,
    NotificationListResponse,
    NotificationReadAllResponse,
    NotificationSummaryResponse,
)
from app.services.notification import (
    broadcast_admin_notification,
    clear_all_notifications,
    delete_notification,
    get_notification_summary,
    mark_all_notifications_read,
    mark_notification_read,
)

router = APIRouter(prefix="/notifications")


@router.get("/summary", response_model=NotificationSummaryResponse)
def notification_summary(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> NotificationSummaryResponse:
    return NotificationSummaryResponse(**get_notification_summary(db, current_user.id))


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> NotificationListResponse:
    items = db.scalars(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    ).all()
    summary = get_notification_summary(db, current_user.id)
    return NotificationListResponse(
        unread_count=summary["unread_count"],
        items=[NotificationItemResponse.model_validate(item) for item in items],
    )


@router.post("/{notification_id}/read", response_model=NotificationItemResponse)
def read_notification(
    notification_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> NotificationItemResponse:
    item = db.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )
    if not item:
        raise HTTPException(status_code=404, detail="通知不存在")
    item = mark_notification_read(db, item)
    return NotificationItemResponse.model_validate(item)


@router.post("/read-all", response_model=NotificationReadAllResponse)
def read_all_notifications(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> NotificationReadAllResponse:
    return NotificationReadAllResponse(updated_count=mark_all_notifications_read(db, current_user.id))


@router.delete("/{notification_id}", response_model=NotificationDeleteResponse)
def remove_notification(
    notification_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> NotificationDeleteResponse:
    item = db.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )
    if not item:
        raise HTTPException(status_code=404, detail="通知不存在。")
    delete_notification(db, item)
    return NotificationDeleteResponse(deleted=True)


@router.delete("", response_model=NotificationClearAllResponse)
def remove_all_notifications(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> NotificationClearAllResponse:
    return NotificationClearAllResponse(deleted_count=clear_all_notifications(db, current_user.id))


@router.post("/broadcast", response_model=AdminBroadcastNotificationResponse)
def create_broadcast_notification(
    payload: AdminBroadcastNotificationRequest,
    current_admin: Annotated[User, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AdminBroadcastNotificationResponse:
    delivered_count = broadcast_admin_notification(
        db,
        title=payload.title,
        message=payload.message,
        actor_user_id=current_admin.id,
    )
    return AdminBroadcastNotificationResponse(delivered_count=delivered_count)
