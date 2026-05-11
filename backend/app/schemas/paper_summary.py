from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

PaperSummaryType = Literal["overview", "annotations", "review", "reproduction", "meeting"]
PaperSummaryStatus = Literal["idle", "running", "generated", "failed"]


class PaperSummaryEvidence(BaseModel):
    page: int | None = None
    quote: str = ""
    source_type: Literal["paper", "annotation"] = "paper"
    annotation_id: int | None = None
    start_char: int | None = None
    end_char: int | None = None


class PaperSummarySection(BaseModel):
    heading: str = ""
    body: str = ""
    keywords: list[str] = Field(default_factory=list)
    evidence: list[PaperSummaryEvidence] = Field(default_factory=list)


class ReviewStructuredFields(BaseModel):
    research_question: str = ""
    core_metrics: list[str] = Field(default_factory=list)
    method_route: str = ""
    data_sample: str = ""
    main_findings: str = ""
    innovations: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    comparison_tags: list[str] = Field(default_factory=list)


class PaperSummaryAssistantPanel(BaseModel):
    title: str = ""
    intent: str = ""
    items: list[str] = Field(default_factory=list)


class PaperSummaryAnnotationItem(BaseModel):
    id: int | None = None
    index: int = 0
    page: int | None = None
    quote: str = ""
    color: str = ""
    start_char: int | None = None
    end_char: int | None = None


class PaperSummaryAnnotationGroup(BaseModel):
    type: Literal["highlight", "underline", "wavy_underline"]
    label: str = ""
    count: int = 0
    items: list[PaperSummaryAnnotationItem] = Field(default_factory=list)


class PaperSummaryContent(BaseModel):
    type: PaperSummaryType
    title: str = ""
    preview: str = ""
    highlights: list[str] = Field(default_factory=list)
    structured_fields: ReviewStructuredFields | None = None
    narrative_sections: list[PaperSummarySection] = Field(default_factory=list)
    sections: list[PaperSummarySection] = Field(default_factory=list)
    annotation_groups: list[PaperSummaryAnnotationGroup] = Field(default_factory=list)
    assistant_panels: list[PaperSummaryAssistantPanel] = Field(default_factory=list)
    missing_items: list[str] = Field(default_factory=list)
    followup_questions: list[str] = Field(default_factory=list)
    source_note: str = ""


class PaperSummaryGenerateRequest(BaseModel):
    provider_id: int | None = Field(default=None, ge=1)
    force: bool = False


class PaperSummaryState(BaseModel):
    type: PaperSummaryType
    title: str
    status: PaperSummaryStatus = "idle"
    stage: str = "idle"
    progress: int = 0
    preview: str = ""
    summary: PaperSummaryContent | None = None
    is_stale: bool = False
    error_message: str | None = None
    updated_at: str | None = None
    model: str = ""


class PaperSummaryStatusResponse(BaseModel):
    status: PaperSummaryStatus = "idle"
    stage: str = "idle"
    progress: int = 0
    summary: PaperSummaryContent | None = None
    is_stale: bool = False
    error_message: str | None = None
    updated_at: str | None = None
    model: str = ""


class PaperSummaryListResponse(BaseModel):
    summaries: list[PaperSummaryState]


def normalize_summary_content(value: dict[str, Any] | None, summary_type: str, title: str) -> dict[str, Any]:
    content = dict(value or {})
    content.setdefault("type", summary_type)
    content.setdefault("title", title)
    content.setdefault("preview", "")
    content.setdefault("highlights", [])
    if summary_type == "review":
        content.setdefault("structured_fields", {
            "research_question": "",
            "core_metrics": [],
            "method_route": "",
            "data_sample": "",
            "main_findings": "",
            "innovations": [],
            "limitations": [],
            "comparison_tags": [],
        })
        content.setdefault("narrative_sections", content.get("sections") or [])
    else:
        content.setdefault("structured_fields", None)
        content.setdefault("narrative_sections", [])
    content.setdefault("sections", [])
    content.setdefault("annotation_groups", [])
    content.setdefault("assistant_panels", [])
    content.setdefault("missing_items", [])
    content.setdefault("followup_questions", [])
    content.setdefault("source_note", "")
    return content
