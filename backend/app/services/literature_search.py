from __future__ import annotations

from dataclasses import dataclass, field
import html
import json
import re
from typing import Any

from app.schemas.literature import LiteratureSearchResult


DEFAULT_SOURCES = ["openalex", "crossref", "arxiv", "semantic_scholar"]


@dataclass
class LiteratureResult:
    source: str
    source_id: str
    title: str
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    venue: str = ""
    doi: str = ""
    arxiv_id: str = ""
    abstract: str = ""
    url: str = ""
    pdf_url: str = ""
    citation_count: int | None = None
    imported_paper_id: int | None = None

    def to_schema(self) -> LiteratureSearchResult:
        return LiteratureSearchResult(
            source=self.source,
            source_id=self.source_id,
            title=self.title,
            authors=self.authors,
            year=self.year,
            venue=self.venue,
            doi=self.doi,
            arxiv_id=self.arxiv_id,
            abstract=self.abstract,
            url=self.url,
            pdf_url=self.pdf_url,
            citation_count=self.citation_count,
            imported_paper_id=self.imported_paper_id,
        )


def compact_text(value: Any) -> str:
    if value is None:
        return ""
    text = html.unescape(str(value))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_doi(value: Any) -> str:
    doi = compact_text(value).lower()
    doi = re.sub(r"^doi:\s*", "", doi)
    doi = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", doi)
    return doi.strip()


def normalize_arxiv_id(value: Any) -> str:
    arxiv_id = compact_text(value)
    arxiv_id = re.sub(r"^https?://arxiv\.org/(?:abs|pdf)/", "", arxiv_id, flags=re.I)
    arxiv_id = re.sub(r"^arxiv:", "", arxiv_id, flags=re.I)
    arxiv_id = re.sub(r"\.pdf$", "", arxiv_id, flags=re.I)
    arxiv_id = re.sub(r"v\d+$", "", arxiv_id, flags=re.I)
    return arxiv_id.strip()


def normalize_openalex_work(work: dict[str, Any]) -> LiteratureResult:
    openalex_id = compact_text(work.get("id"))
    primary_location = work.get("primary_location") or {}
    source = primary_location.get("source") or {}
    authors = [
        compact_text((authorship.get("author") or {}).get("display_name"))
        for authorship in work.get("authorships") or []
        if compact_text((authorship.get("author") or {}).get("display_name"))
    ]

    return LiteratureResult(
        source="openalex",
        source_id=openalex_id.rstrip("/").split("/")[-1],
        title=compact_text(work.get("display_name")),
        authors=authors,
        year=_int_or_none(work.get("publication_year")),
        venue=compact_text(source.get("display_name")),
        doi=normalize_doi(work.get("doi")),
        abstract=_abstract_from_openalex_index(work.get("abstract_inverted_index") or {}),
        url=compact_text(primary_location.get("landing_page_url")) or openalex_id,
        pdf_url=compact_text(primary_location.get("pdf_url")),
        citation_count=_int_or_none(work.get("cited_by_count")),
    )


def normalize_crossref_work(work: dict[str, Any]) -> LiteratureResult:
    doi = normalize_doi(work.get("DOI"))
    return LiteratureResult(
        source="crossref",
        source_id=doi,
        title=compact_text(_first(work.get("title"))),
        authors=_crossref_authors(work.get("author") or []),
        year=_crossref_year(work),
        venue=compact_text(_first(work.get("container-title"))),
        doi=doi,
        abstract=compact_text(work.get("abstract")),
        url=compact_text(work.get("URL")),
    )


def normalize_arxiv_entry(entry: Any) -> LiteratureResult:
    entry_id = compact_text(_get(entry, "id"))
    arxiv_id = normalize_arxiv_id(entry_id)
    links = _get(entry, "links") or []
    pdf_url = _arxiv_pdf_url(links)

    return LiteratureResult(
        source="arxiv",
        source_id=arxiv_id,
        title=compact_text(_get(entry, "title")),
        authors=_arxiv_authors(_get(entry, "authors") or []),
        year=_year_from_date(_get(entry, "published")),
        arxiv_id=arxiv_id,
        abstract=compact_text(_get(entry, "summary")),
        url=entry_id,
        pdf_url=pdf_url,
    )


def normalize_semantic_scholar_paper(paper: dict[str, Any]) -> LiteratureResult:
    external_ids = paper.get("externalIds") or {}
    open_access_pdf = paper.get("openAccessPdf") or {}

    return LiteratureResult(
        source="semantic_scholar",
        source_id=compact_text(paper.get("paperId")),
        title=compact_text(paper.get("title")),
        authors=[
            compact_text(author.get("name"))
            for author in paper.get("authors") or []
            if compact_text(author.get("name"))
        ],
        year=_int_or_none(paper.get("year")),
        venue=compact_text(paper.get("venue")),
        doi=normalize_doi(external_ids.get("DOI") or external_ids.get("doi")),
        arxiv_id=normalize_arxiv_id(external_ids.get("ArXiv") or external_ids.get("arxiv")),
        abstract=compact_text(paper.get("abstract")),
        url=compact_text(paper.get("url")),
        pdf_url=compact_text(open_access_pdf.get("url")),
        citation_count=_int_or_none(paper.get("citationCount")),
    )


def dedupe_literature_results(results: list[LiteratureResult]) -> list[LiteratureResult]:
    deduped: dict[tuple[Any, ...], LiteratureResult] = {}

    for result in results:
        if not compact_text(result.title):
            continue
        key = _dedupe_key(result)
        current = deduped.get(key)
        if current is None or _quality_score(result) > _quality_score(current):
            deduped[key] = result

    return sorted(
        deduped.values(),
        key=lambda item: item.citation_count if item.citation_count is not None else -1,
        reverse=True,
    )


def normalize_sources(sources: list[str]) -> list[str]:
    valid_sources = set(DEFAULT_SOURCES)
    normalized = []
    for source in sources:
        clean_source = compact_text(source).lower()
        if clean_source in valid_sources and clean_source not in normalized:
            normalized.append(clean_source)
    return normalized or DEFAULT_SOURCES.copy()


def cache_key(query: str, sources: list[str], limit: int) -> str:
    return json.dumps(
        {
            "q": compact_text(query).lower(),
            "sources": sorted(normalize_sources(sources)),
            "limit": limit,
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def _abstract_from_openalex_index(index: dict[str, list[int]]) -> str:
    positioned_words: list[tuple[int, str]] = []
    for word, positions in index.items():
        for position in positions:
            positioned_words.append((position, word))
    return compact_text(" ".join(word for _, word in sorted(positioned_words)))


def _first(value: Any) -> Any:
    if isinstance(value, list):
        return value[0] if value else ""
    return value


def _get(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)


def _crossref_authors(authors: list[dict[str, Any]]) -> list[str]:
    normalized_authors = []
    for author in authors:
        name = compact_text(author.get("name"))
        if not name:
            name = compact_text(f"{author.get('given', '')} {author.get('family', '')}")
        if name:
            normalized_authors.append(name)
    return normalized_authors


def _crossref_year(work: dict[str, Any]) -> int | None:
    for key in ("published-print", "published-online", "published"):
        year = _year_from_date_parts((work.get(key) or {}).get("date-parts"))
        if year is not None:
            return year
    return None


def _year_from_date_parts(date_parts: Any) -> int | None:
    if not date_parts or not isinstance(date_parts, list) or not date_parts[0]:
        return None
    return _int_or_none(date_parts[0][0])


def _year_from_date(value: Any) -> int | None:
    text = compact_text(value)
    match = re.match(r"(\d{4})", text)
    return int(match.group(1)) if match else None


def _arxiv_authors(authors: list[Any]) -> list[str]:
    normalized_authors = []
    for author in authors:
        name = compact_text(author.get("name") if isinstance(author, dict) else _get(author, "name"))
        if not name and isinstance(author, str):
            name = compact_text(author)
        if name:
            normalized_authors.append(name)
    return normalized_authors


def _arxiv_pdf_url(links: list[Any]) -> str:
    for link in links:
        href = compact_text(link.get("href") if isinstance(link, dict) else _get(link, "href"))
        link_type = compact_text(link.get("type") if isinstance(link, dict) else _get(link, "type"))
        title = compact_text(link.get("title") if isinstance(link, dict) else _get(link, "title"))
        if href and (link_type == "application/pdf" or title.lower() == "pdf" or "/pdf/" in href):
            return href
    return ""


def _dedupe_key(result: LiteratureResult) -> tuple[Any, ...]:
    doi = normalize_doi(result.doi)
    if doi:
        return ("doi", doi)
    arxiv_id = normalize_arxiv_id(result.arxiv_id)
    if arxiv_id:
        return ("arxiv", arxiv_id)
    return ("title_year", re.sub(r"\W+", " ", result.title.lower()).strip(), result.year)


def _quality_score(result: LiteratureResult) -> tuple[int, int, int, int, int, int]:
    return (
        1 if result.pdf_url else 0,
        1 if result.abstract else 0,
        result.citation_count if result.citation_count is not None else -1,
        1 if result.doi else 0,
        len(result.authors),
        len(result.title),
    )


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
