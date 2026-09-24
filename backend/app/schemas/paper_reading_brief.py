from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


PaperReadingBriefStatus = Literal["idle", "queued", "running", "completed", "failed"]
BriefBasis = Literal["paper_explicit", "paper_inference", "general_knowledge"]


class BriefEvidenceItem(BaseModel):
    text: str = ""
    pages: list[int] = Field(default_factory=list)
    figures: list[str] = Field(default_factory=list)
    basis: BriefBasis = "paper_explicit"


class BriefTerm(BaseModel):
    term: str = ""
    chinese_name: str = ""
    abbreviation: str = ""
    standard_explanation: str = ""
    plain_explanation: str = ""
    paper_role: str = ""
    pages: list[int] = Field(default_factory=list)
    figures: list[str] = Field(default_factory=list)
    basis: BriefBasis = "paper_explicit"


class PaperReadingBriefContent(BaseModel):
    one_sentence_conclusion: BriefEvidenceItem = Field(default_factory=BriefEvidenceItem)
    background_and_pain_points: list[BriefEvidenceItem] = Field(default_factory=list)
    research_objective: list[BriefEvidenceItem] = Field(default_factory=list)
    core_methods_or_models: list[BriefEvidenceItem] = Field(default_factory=list)
    results_and_comparisons: list[BriefEvidenceItem] = Field(default_factory=list)
    conclusions_and_contributions: list[BriefEvidenceItem] = Field(default_factory=list)
    limitations_and_boundaries: list[BriefEvidenceItem] = Field(default_factory=list)
    key_terms: list[BriefTerm] = Field(default_factory=list)
    source_note: str = ""


class PaperReadingBriefResponse(BaseModel):
    status: PaperReadingBriefStatus = "idle"
    stage: str = "idle"
    progress: int = 0
    brief: PaperReadingBriefContent | None = None
    error_message: str | None = None
    updated_at: str | None = None
    model: str = ""


class PaperReadingBriefEnsureRequest(BaseModel):
    provider_id: int | None = Field(default=None, ge=1)
