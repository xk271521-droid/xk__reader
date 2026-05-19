from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


NotificationSourceKind = Literal["paper_summary", "full_translation", "research_matrix", "admin_broadcast"]
NotificationEventKind = Literal["completed", "failed", "broadcast"]
NotificationActionKind = Literal["open-summary", "open-full-translation", "open-matrix", "none"]


class NotificationItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_kind: NotificationSourceKind
    source_id: int
    event_kind: NotificationEventKind
    title: str
    message: str
    action_kind: NotificationActionKind
    action_payload: dict[str, Any] = Field(default_factory=dict)
    read_at: datetime | None = None
    created_at: datetime


class NotificationSummaryResponse(BaseModel):
    unread_count: int = 0
    latest_notification_id: int | None = None
    latest_created_at: datetime | None = None


class NotificationListResponse(BaseModel):
    unread_count: int = 0
    items: list[NotificationItemResponse] = Field(default_factory=list)


class NotificationReadAllResponse(BaseModel):
    updated_count: int = 0


class NotificationDeleteResponse(BaseModel):
    deleted: bool = True


class NotificationClearAllResponse(BaseModel):
    deleted_count: int = 0


class AdminBroadcastNotificationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=1000)

    @field_validator("title", "message")
    @classmethod
    def strip_text(cls, value: str) -> str:
        normalized = " ".join(value.split()).strip()
        if not normalized:
            raise ValueError("通知内容不能为空。")
        return normalized


class AdminBroadcastNotificationResponse(BaseModel):
    delivered_count: int = 0
