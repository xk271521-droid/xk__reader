from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ReadingRecordCreate(BaseModel):
    paper_id: int
    opened_at: datetime | None = None
    duration_seconds: int = 0


class ReadingRecordDurationUpdate(BaseModel):
    duration_seconds: int


class ReadingRecordSyncPayload(BaseModel):
    records: list[ReadingRecordCreate]


class ReadingRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    paper_id: int
    file_name: str = ""
    title: str = ""
    author: str = ""
    folder_name: str = ""
    opened_at: str
    duration_seconds: int = 0


class ReadingStatsResponse(BaseModel):
    weekly_opens: int
    weekly_distinct_papers: int
    time_distribution: dict[str, int]
    dominant_period: str | None
    recent_records: list[ReadingRecordResponse]


class ReadingDashboardResponse(BaseModel):
    overview: dict[str, int | float | str | None] = Field(default_factory=dict)
    reading_trend: list[dict[str, int | float | str]] = Field(default_factory=list)
    import_trend: list[dict[str, int | float | str]] = Field(default_factory=list)
    time_distribution: list[dict[str, int | float | str]] = Field(default_factory=list)
    folder_distribution: list[dict[str, int | float | str]] = Field(default_factory=list)
    resource_distribution: list[dict[str, int | float | str]] = Field(default_factory=list)
    recent_readings: list[dict[str, str | int | float | None]] = Field(default_factory=list)
    recent_imports: list[dict[str, str | int | float | None]] = Field(default_factory=list)
    spotlight_papers: list[dict[str, str | int | float | None]] = Field(default_factory=list)
    insight_cards: list[dict[str, str | int | float | None]] = Field(default_factory=list)
