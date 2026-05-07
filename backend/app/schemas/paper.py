from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return value.strip()


class FolderUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return value.strip()


class FolderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: str | None = None


class PaperResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    folder_id: int
    file_name: str
    file_size: str
    title: str
    translated_title: str | None = None
    author: str | None = None
    subject: str | None = None
    keywords: str | None = None
    creator: str | None = None
    producer: str | None = None
    creation_date: str | None = None
    modification_date: str | None = None
    doi: str | None = None
    page_count: int = 0
    last_viewed_at: str | None = None
    created_at: str | None = None


class PaperUpdate(BaseModel):
    folder_id: int | None = Field(default=None)
    last_viewed_at: bool = False
    title: str | None = Field(default=None, max_length=300)
    translated_title: str | None = None
    author: str | None = None
    subject: str | None = None
    keywords: str | None = None
    doi: str | None = None
    page_count: int | None = None


class PaperMetadata(BaseModel):
    title: str = ""
    translated_title: str | None = None
    author: str | None = None
    subject: str | None = None
    keywords: str | None = None
    creator: str | None = None
    producer: str | None = None
    creation_date: str | None = None
    modification_date: str | None = None
    doi: str | None = None
    page_count: int = 0


class FullTranslationBlock(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    kind: str = Field(default="paragraph", max_length=40)
    source_text: str = Field(default="", max_length=5000)
    translated_text: str = Field(default="", max_length=8000)
    bbox: list[float] = Field(default_factory=list, max_length=4)
    font_size: float = 12
    font_weight: int = 400
    align: str = Field(default="left", max_length=20)
    skip_translate: bool = False


class FullTranslationPage(BaseModel):
    page_number: int = Field(ge=1)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    blocks: list[FullTranslationBlock] = Field(default_factory=list)


class FullTranslationStartRequest(BaseModel):
    source_hash: str = Field(min_length=8, max_length=64)
    pages: list[FullTranslationPage] = Field(default_factory=list, min_length=1)
    provider_id: int | None = Field(default=None, ge=1)


class FullTranslationResponse(BaseModel):
    status: Literal["idle", "running", "completed", "error"] = "idle"
    source_hash: str = ""
    pages: list[dict[str, Any]] = Field(default_factory=list)
    completed_units: int = 0
    total_units: int = 0
    error_message: str | None = None
    provider_id: int | None = None
