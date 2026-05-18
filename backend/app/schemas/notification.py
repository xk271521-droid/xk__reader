from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


NotificationSourceKind = Literal["paper_summary", "full_translation", "research_matrix"]
NotificationEventKind = Literal["completed", "failed"]
NotificationActionKind = Literal["open-summary", "open-full-translation", "open-matrix"]


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
