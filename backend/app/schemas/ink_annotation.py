from __future__ import annotations

from pydantic import BaseModel, Field


class InkPoint(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class InkAnnotationCreate(BaseModel):
    page_number: int = Field(ge=1)
    color: str = Field(default="#15803D", max_length=20)
    opacity: float = Field(default=0.85, ge=0.05, le=1)
    stroke_width: float = Field(default=6, ge=1, le=48)
    points: list[InkPoint] = Field(min_length=2, max_length=5000)


class InkAnnotationResponse(BaseModel):
    id: int
    page_number: int
    color: str
    opacity: float
    stroke_width: float
    points: list[InkPoint]
    created_at: str | None = None
    updated_at: str | None = None


class InkAnnotationListResponse(BaseModel):
    ink_annotations: list[InkAnnotationResponse]
