from __future__ import annotations

from pydantic import BaseModel, Field


class AnnotationRect(BaseModel):
    left: float = Field(ge=0)
    top: float = Field(ge=0)
    width: float = Field(ge=0)
    height: float = Field(ge=0)


class AnnotationCreate(BaseModel):
    page_number: int = Field(ge=1)
    start_char: int = Field(ge=0)
    end_char: int = Field(ge=0)
    quote_text: str = Field(min_length=1, max_length=5000)
    rects: list[AnnotationRect] = Field(default_factory=list)
    type: str = Field(default="highlight", pattern=r"^(highlight|underline|wavy_underline)$")
    color: str | None = Field(default=None, max_length=20)
    source: str = Field(default="native", pattern=r"^(native|ocr)$")
    geometry_version: str = Field(default="v2", pattern=r"^(v1|v2)$")


class AnnotationEraseRequest(BaseModel):
    page_number: int = Field(ge=1)
    start_char: int = Field(ge=0)
    end_char: int = Field(ge=0)


class AnnotationRestoreItem(BaseModel):
    page_number: int = Field(ge=1)
    start_char: int = Field(ge=0)
    end_char: int = Field(ge=0)
    quote_text: str = Field(min_length=1, max_length=5000)
    rects: list[AnnotationRect] = Field(default_factory=list)
    type: str = Field(default="highlight", pattern=r"^(highlight|underline|wavy_underline)$")
    color: str | None = Field(default=None, max_length=20)
    source: str = Field(default="native", pattern=r"^(native|ocr)$")
    geometry_version: str = Field(default="v1", pattern=r"^(v1|v2)$")


class AnnotationRestoreRequest(BaseModel):
    annotations: list[AnnotationRestoreItem] = Field(default_factory=list, max_length=5000)


class AnnotationResponse(BaseModel):
    id: int
    page_number: int
    start_char: int
    end_char: int
    quote_text: str
    rects: list[AnnotationRect]
    type: str
    color: str | None = None
    source: str
    geometry_version: str = "v1"
    created_at: str | None = None


class AnnotationListResponse(BaseModel):
    annotations: list[AnnotationResponse]
