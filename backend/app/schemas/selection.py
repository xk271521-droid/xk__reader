from typing import List

from pydantic import BaseModel, Field


class SelectionInsightRequest(BaseModel):
    text: str = Field(min_length=3, max_length=1500)
    paper_title: str | None = Field(default=None, max_length=200)


class SelectionInsightResponse(BaseModel):
    translation: str
    explanation: str
    keywords: List[str]
    source: str
