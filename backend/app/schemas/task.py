from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TaskCenterItemResponse(BaseModel):
    id: str
    source_kind: str
    source_id: int
    status: str
    status_group: str
    status_label: str
    stage: str = "idle"
    stage_label: str = "等待中"
    title: str
    subtitle: str = ""
    progress_percent: int = 0
    error_message: str | None = None
    action_kind: str = "none"
    action_payload: dict[str, Any] = Field(default_factory=dict)
    can_cancel: bool = False
    can_retry: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TaskCenterSummaryResponse(BaseModel):
    active_count: int = 0
    failed_count: int = 0
    completed_count: int = 0
    total_count: int = 0
    attention_count: int = 0


class TaskCenterResponse(BaseModel):
    summary: TaskCenterSummaryResponse = Field(default_factory=TaskCenterSummaryResponse)
    items: list[TaskCenterItemResponse] = Field(default_factory=list)


class TaskCenterArchiveRequest(BaseModel):
    task_ids: list[str] = Field(default_factory=list, max_length=200)


class TaskCenterArchiveResponse(BaseModel):
    archived_ids: list[str] = Field(default_factory=list)
    archived_count: int = 0
    skipped_ids: list[str] = Field(default_factory=list)
    summary: TaskCenterSummaryResponse = Field(default_factory=TaskCenterSummaryResponse)
