from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


PaperAiOutlineStatus = Literal["idle", "queued", "running", "completed", "failed"]
PaperAiOutlineMode = Literal["generated", "native_titles"]


class PaperAiOutlineItem(BaseModel):
    title_cn: str = Field(default="", max_length=180)
    title_en: str = Field(default="", max_length=240)
    page: int | None = Field(default=None, ge=1)
    children: list["PaperAiOutlineItem"] = Field(default_factory=list, max_length=40)


class PaperAiOutlineContent(BaseModel):
    items: list[PaperAiOutlineItem] = Field(default_factory=list, max_length=40)


class PaperAiOutlineResponse(BaseModel):
    status: PaperAiOutlineStatus = "idle"
    stage: str = "idle"
    progress: int = 0
    outline: PaperAiOutlineContent | None = None
    error_message: str | None = None
    updated_at: str | None = None
    model: str = ""
    mode: PaperAiOutlineMode = "generated"


class PaperAiOutlineEnsureRequest(BaseModel):
    provider_id: int | None = Field(default=None, ge=1)
    native_outline: PaperAiOutlineContent | None = None
