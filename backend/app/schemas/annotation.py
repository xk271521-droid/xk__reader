from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AnnotationCreate(BaseModel):
    page_number: int = Field(ge=1)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(ge=0)
    selected_text: str = Field(min_length=1, max_length=500)
    type: str = Field(default="highlight", pattern=r"^(highlight|underline|wavy_underline)$")
    color: str | None = Field(default=None, max_length=20)


class AnnotationResponse(BaseModel):
    id: int
    page_number: int
    start_offset: int
    end_offset: int
    selected_text: str
    type: str
    color: str | None = None
    created_at: str | None = None


class AnnotationListResponse(BaseModel):
    annotations: list[AnnotationResponse]
