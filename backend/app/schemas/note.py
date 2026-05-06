from __future__ import annotations

from pydantic import BaseModel, Field


class PaperNoteBlockPayload(BaseModel):
    id: int | str | None = None
    type: str = Field(default="text", pattern=r"^(text|quote|image)$")
    content: str = Field(default="", max_length=20000)
    image_url: str | None = None
    page_number: int | None = Field(default=None, ge=1)
    start_char: int | None = Field(default=None, ge=0)
    end_char: int | None = Field(default=None, ge=0)
    context_before: str = Field(default="", max_length=4000)
    context_after: str = Field(default="", max_length=4000)
    sort_order: int = Field(default=0, ge=0)


class PaperNoteNodePayload(BaseModel):
    id: int | str | None = None
    parent_id: int | str | None = None
    level: int = Field(default=1, ge=1, le=3)
    title: str = Field(default="New heading", max_length=200)
    color_index: int = Field(default=0, ge=0, le=9)
    sort_order: int = Field(default=0, ge=0)
    collapsed: bool = False
    blocks: list[PaperNoteBlockPayload] = Field(default_factory=list)


class PaperNotebookPayload(BaseModel):
    id: int | str | None = None
    title: str = Field(default="New notebook", max_length=200)
    template_type: str = Field(default="blank", pattern=r"^(blank|default)$")
    sort_order: int = Field(default=0, ge=0)
    collapsed: bool = True
    nodes: list[PaperNoteNodePayload] = Field(default_factory=list)


class PaperNotesSaveRequest(BaseModel):
    notebooks: list[PaperNotebookPayload] = Field(default_factory=list)


class PaperNoteBlockResponse(BaseModel):
    id: int
    type: str
    content: str
    image_url: str | None = None
    page_number: int | None = None
    start_char: int | None = None
    end_char: int | None = None
    context_before: str = ""
    context_after: str = ""
    sort_order: int = 0


class PaperNoteNodeResponse(BaseModel):
    id: int
    parent_id: int | None = None
    level: int
    title: str
    color_index: int
    sort_order: int
    collapsed: bool
    blocks: list[PaperNoteBlockResponse] = Field(default_factory=list)


class PaperNotebookResponse(BaseModel):
    id: int
    title: str
    template_type: str
    sort_order: int
    collapsed: bool
    nodes: list[PaperNoteNodeResponse] = Field(default_factory=list)


class PaperNotebookListResponse(BaseModel):
    notebooks: list[PaperNotebookResponse] = Field(default_factory=list)
