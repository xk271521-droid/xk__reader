from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ResearchMatrixCreateRequest(BaseModel):
    title: str = Field(default="", max_length=160)
    paper_ids: list[int] = Field(min_length=1, max_length=50)
    include_reproduction: bool = True
    provider_id: int | None = Field(default=None, ge=1)


class ResearchMatrixGenerateMissingRequest(BaseModel):
    paper_ids: list[int] = Field(min_length=1, max_length=50)
    provider_id: int | None = Field(default=None, ge=1)


class ResearchMatrixRefreshRequest(BaseModel):
    title: str = Field(default="", max_length=160)
    provider_id: int | None = Field(default=None, ge=1)


class ResearchMatrixRunPaperUpdateRequest(BaseModel):
    paper_field_updates: dict[str, Any] = Field(default_factory=dict)
    run_field_updates: dict[str, Any] = Field(default_factory=dict)


class ResearchMatrixRunPaperResponse(BaseModel):
    paper_id: int | None = None
    title: str = ""
    file_name: str = ""
    folder_name: str = ""
    summary_status: str = "missing"
    summary_updated_at: str = ""
    is_missing: bool = False
    is_stale: bool = False
    review_role: str = ""
    batch_note: str = ""
    row: dict[str, Any] = Field(default_factory=dict)


class ResearchMatrixRunListItem(BaseModel):
    id: int
    title: str
    status: str
    stage: str = "idle"
    stage_label: str = ""
    paper_count: int
    version: int = 1
    refreshed_from_id: int | None = None
    has_updates: bool = False
    missing_count: int = 0
    stale_count: int = 0
    progress_percent: int = 0
    ready_count: int = 0
    total_count: int = 0
    failed_count: int = 0
    error_message: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ResearchMatrixRunResponse(ResearchMatrixRunListItem):
    matrix: dict[str, Any] = Field(default_factory=dict)
    drafts: dict[str, Any] = Field(default_factory=dict)
    dashboard: dict[str, Any] = Field(default_factory=dict)
    papers: list[ResearchMatrixRunPaperResponse] = Field(default_factory=list)
    refresh_available: bool = False


class ResearchMatrixRunListResponse(BaseModel):
    runs: list[ResearchMatrixRunListItem] = Field(default_factory=list)


class ResearchMatrixGenerateMissingResponse(BaseModel):
    started_count: int = 0
    skipped_count: int = 0
    running_count: int = 0


class ResearchDashboardResponse(BaseModel):
    reading_trend: list[dict[str, Any]] = Field(default_factory=list)
    resource_mix: list[dict[str, Any]] = Field(default_factory=list)
    summary_coverage: list[dict[str, Any]] = Field(default_factory=list)
    folder_activity: list[dict[str, Any]] = Field(default_factory=list)
    matrix_readiness: dict[str, Any] = Field(default_factory=dict)
    totals: dict[str, Any] = Field(default_factory=dict)


class ResearchMatrixSynthesizeRequest(BaseModel):
    paper_ids: list[int] = Field(min_length=1, max_length=50)
    mode: Literal["related_work", "method_compare", "limitations"] = "related_work"
    title: str = Field(default="", max_length=160)


class ResearchMatrixSynthesizeResponse(BaseModel):
    mode: str
    title: str
    content: str
    source_titles: list[str] = Field(default_factory=list)
    ai_generated: bool = False
