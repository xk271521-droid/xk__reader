from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ReadingRecordCreate(BaseModel):
    paper_id: int
    opened_at: datetime | None = None


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


class ReadingStatsResponse(BaseModel):
    weekly_opens: int
    weekly_distinct_papers: int
    time_distribution: dict[str, int]
    dominant_period: str | None
    recent_records: list[ReadingRecordResponse]
