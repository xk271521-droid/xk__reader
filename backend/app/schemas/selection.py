from typing import List, Literal

from pydantic import BaseModel, Field


class SelectionInsightRequest(BaseModel):
    text: str = Field(min_length=2, max_length=1500)
    paper_title: str | None = Field(default=None, max_length=200)
    domain: str = Field(default="it", max_length=32)
    summary: str | None = Field(default=None, max_length=2000)
    context: str | None = Field(default=None, max_length=2000)
    provider_id: int | None = Field(default=None, ge=1)


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


class SelectionInsightExplainResponse(BaseModel):
    explanation: str


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    selected_text: str = Field(default="", max_length=2000)
    paper_title: str | None = Field(default=None, max_length=300)
    summary: str | None = Field(default=None, max_length=4000)
    provider_id: int | None = Field(default=None, ge=1)


class AskResponse(BaseModel):
    answer: str


class SuggestQuestionMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=2000)


class SuggestQuestionGroup(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    rationale: str = Field(min_length=1, max_length=200)
    questions: List[str] = Field(default_factory=list, max_length=3)


class SuggestQuestionsRequest(BaseModel):
    mode: Literal["initial", "followup"] = "initial"
    paper_title: str | None = Field(default=None, max_length=300)
    summary: str | None = Field(default=None, max_length=4000)
    selected_text: str = Field(default="", max_length=2000)
    last_user_question: str = Field(default="", max_length=2000)
    last_assistant_answer: str = Field(default="", max_length=4000)
    recent_messages: List[SuggestQuestionMessage] = Field(default_factory=list, max_length=6)
    provider_id: int | None = Field(default=None, ge=1)


class SuggestQuestionsResponse(BaseModel):
    questions: List[str] = Field(default_factory=list, max_length=3)
    groups: List[SuggestQuestionGroup] = Field(default_factory=list, max_length=3)
    source: str = Field(default="fallback", max_length=120)
