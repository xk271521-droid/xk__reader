from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator


PAPER_TEXT_LIMITS = {
    "title": 300,
    "translated_title": 300,
    "author": 200,
    "subject": 300,
    "keywords": 300,
    "creator": 200,
    "producer": 200,
    "creation_date": 50,
    "modification_date": 50,
    "doi": 200,
    "arxiv_id": 80,
}


def compact_paper_text(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit].rstrip()


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
    file_path: str
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
    arxiv_id: str | None = None
    page_count: int = 0
    last_viewed_at: str | None = None
    created_at: str | None = None


class PaperTrashResponse(BaseModel):
    id: int
    folder_id: int
    folder_name: str = "未分类"
    file_name: str
    file_size: str
    title: str
    author: str | None = None
    page_count: int = 0
    deleted_at: str
    expires_at: str


class PaperUpdate(BaseModel):
    folder_id: int | None = Field(default=None)
    last_viewed_at: bool = False
    title: str | None = Field(default=None, max_length=300)
    translated_title: str | None = Field(default=None, max_length=300)
    author: str | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, max_length=300)
    keywords: str | None = Field(default=None, max_length=300)
    doi: str | None = Field(default=None, max_length=200)
    arxiv_id: str | None = Field(default=None, max_length=80)
    page_count: int | None = None

    @field_validator("title", "translated_title", "author", "subject", "keywords", "doi", "arxiv_id", mode="before")
    @classmethod
    def normalize_text_field(cls, value: str | None, info: ValidationInfo) -> str | None:
        return compact_paper_text(value, PAPER_TEXT_LIMITS.get(info.field_name, 300))


class PaperMetadata(BaseModel):
    title: str = Field(default="", max_length=300)
    translated_title: str | None = Field(default=None, max_length=300)
    author: str | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, max_length=300)
    keywords: str | None = Field(default=None, max_length=300)
    creator: str | None = Field(default=None, max_length=200)
    producer: str | None = Field(default=None, max_length=200)
    creation_date: str | None = Field(default=None, max_length=50)
    modification_date: str | None = Field(default=None, max_length=50)
    doi: str | None = Field(default=None, max_length=200)
    arxiv_id: str | None = Field(default=None, max_length=80)
    page_count: int = 0

    @field_validator(
        "title",
        "translated_title",
        "author",
        "subject",
        "keywords",
        "creator",
        "producer",
        "creation_date",
        "modification_date",
        "doi",
        "arxiv_id",
        mode="before",
    )
    @classmethod
    def normalize_text_field(cls, value: str | None, info: ValidationInfo) -> str | None:
        text = compact_paper_text(value, PAPER_TEXT_LIMITS.get(info.field_name, 300))
        if info.field_name == "title":
            return text or ""
        return text


class FullTranslationBlock(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    kind: str = Field(default="paragraph", max_length=40)
    type: str = Field(default="text", max_length=40)
    source_text: str = Field(default="", max_length=5000)
    translated_text: str = Field(default="", max_length=8000)
    bbox: list[float] = Field(default_factory=list, max_length=4)
    font_size: float = 12
    font_weight: int = 400
    align: str = Field(default="left", max_length=20)
    column: str = Field(default="full", max_length=16)
    skip_translate: bool = False
    translate_policy: str = Field(default="translate", max_length=24)
    status: str = Field(default="pending", max_length=24)
    asset_url: str | None = Field(default=None, max_length=1000)
    snapshot_url: str | None = Field(default=None, max_length=1000)


class FullTranslationPage(BaseModel):
    page_number: int = Field(ge=1)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    layout: dict[str, Any] = Field(default_factory=dict)
    blocks: list[FullTranslationBlock] = Field(default_factory=list)


class FullTranslationStartRequest(BaseModel):
    source_hash: str = Field(min_length=8, max_length=64)
    pages: list[FullTranslationPage] = Field(default_factory=list, min_length=1)
    provider_id: int | None = Field(default=None, ge=1)
    parse_mode: Literal["auto", "local", "aliyun"] = "auto"


class FullTranslationResponse(BaseModel):
    status: Literal["idle", "running", "completed", "partial_failed", "error", "cancelled"] = "idle"
    source_hash: str = ""
    pages: list[dict[str, Any]] = Field(default_factory=list)
    completed_units: int = 0
    total_units: int = 0
    error_message: str | None = None
    provider_id: int | None = None
    parse_mode: str = "auto"
    parse_engine: str = "local"
    parse_summary: dict[str, Any] = Field(default_factory=dict)
    translation_engine: str = "ai"
    termbase_version: str = ""
    failed_blocks_count: int = 0
    pending_blocks_count: int = 0
