from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


SHAPE_TYPE_PATTERN = r"^(text|arrow|rect|circle|pin)$"


class ShapeAnnotationCreate(BaseModel):
    page_number: int = Field(ge=1)
    type: str = Field(pattern=SHAPE_TYPE_PATTERN)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(ge=0, le=1)
    height: float = Field(ge=0, le=1)
    content: str | None = Field(default=None, max_length=5000)
    style: dict[str, Any] = Field(default_factory=dict)
    extra: dict[str, Any] = Field(default_factory=dict)
    sort_order: int = Field(default=0, ge=0, le=1000000)


class ShapeAnnotationUpdate(BaseModel):
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)
    width: float | None = Field(default=None, ge=0, le=1)
    height: float | None = Field(default=None, ge=0, le=1)
    content: str | None = Field(default=None, max_length=5000)
    style: dict[str, Any] | None = None
    extra: dict[str, Any] | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1000000)


class ShapeAnnotationResponse(BaseModel):
    id: int
    page_number: int
    type: str
    x: float
    y: float
    width: float
    height: float
    content: str | None = None
    style: dict[str, Any] = Field(default_factory=dict)
    extra: dict[str, Any] = Field(default_factory=dict)
    sort_order: int = 0
    created_at: str | None = None
    updated_at: str | None = None


class ShapeAnnotationListResponse(BaseModel):
    shape_annotations: list[ShapeAnnotationResponse]
