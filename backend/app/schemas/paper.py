from __future__ import annotations

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
