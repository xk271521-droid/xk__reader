from __future__ import annotations

from pydantic import BaseModel, Field


class LiteratureSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=300)
    limit: int = Field(default=20, ge=1, le=50)
    sources: list[str] = Field(default_factory=list)


class LiteratureSearchResult(BaseModel):
    source: str
    source_id: str
    title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    venue: str = ""
    doi: str = ""
    arxiv_id: str = ""
    abstract: str = ""
    url: str = ""
    pdf_url: str = ""
    citation_count: int | None = None
    imported_paper_id: int | None = None


class LiteratureSearchResponse(BaseModel):
    query: str
    results: list[LiteratureSearchResult]
    sources: list[str]
    cached: bool = False
