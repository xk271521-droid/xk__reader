from typing import List, Literal

from pydantic import BaseModel, Field


class SelectionInsightRequest(BaseModel):
    text: str = Field(min_length=2, max_length=1500)
    paper_title: str | None = Field(default=None, max_length=200)


class SelectionGlossaryItem(BaseModel):
    term: str = Field(min_length=1, max_length=80)
    note: str = Field(min_length=1, max_length=200)


class SelectionInsightResponse(BaseModel):
    translation: str
    explanation: str
    keywords: List[str]
    source: str
    text_kind: Literal["word", "phrase", "sentence", "title", "passage"]
    focus_points: List[str]
    glossary: List[SelectionGlossaryItem]
