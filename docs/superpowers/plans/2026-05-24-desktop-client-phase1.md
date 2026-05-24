# Desktop Client Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable Windows desktop client foundation and the shared backend literature-search API it needs.

**Architecture:** The desktop app is a separate sibling project at `C:/Users/xk/Desktop/paper-reader-desktop`; it does not modify the existing web frontend. The existing FastAPI backend gains reusable literature-search endpoints that both desktop and web can call. The desktop app uses Electron main/preload for native file, notification, and local-store capabilities, with React/Vite in the renderer for the research workspace UI.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy cache model already present in the backend, Python `unittest`, Electron, React, Vite, Node `node:test`, JSON local store for Phase 1.

---

## Scope Boundary

This plan builds a working Phase 1 slice:

- Backend literature search normalization, caching, and API route.
- Independent Electron/React desktop project.
- Desktop login/server health wiring.
- Literature hub with aggregated backend search and academic-site browser shell.
- Local PDF entry through file dialog and drag/drop path resolution.
- Local JSON cache and sync queue skeleton for offline notes/progress submissions.
- Windows notification bridge for task completion events.

This plan intentionally does not change `frontend/`. It may modify `backend/` because the user approved adding shared backend APIs.

## File Structure

Backend files in the existing repository:

- Create `backend/app/schemas/literature.py`: request/response schemas for normalized literature search results.
- Create `backend/app/services/literature_search.py`: source normalization, deduplication, cache key handling, and source fetch orchestration.
- Create `backend/app/api/routes/literature.py`: authenticated `/literature/search` API route.
- Modify `backend/app/api/router.py`: mount the literature router.
- Create `backend/tests/test_literature_search.py`: unit tests for normalization and deduplication.
- Create `backend/tests/test_literature_route.py`: route-level test with dependency overrides.

Desktop files in new sibling project `C:/Users/xk/Desktop/paper-reader-desktop`:

- Create `package.json`: scripts and dependencies.
- Create `index.html`: Vite renderer entry.
- Create `vite.config.js`: renderer build config.
- Create `src/main/main.js`: Electron app lifecycle.
- Create `src/main/createWindow.js`: secure browser window creation.
- Create `src/main/ipc.js`: IPC handlers for files, local store, notifications.
- Create `src/main/localStore.js`: JSON local store and sync queue.
- Create `src/preload/index.js`: context-isolated desktop bridge.
- Create `src/renderer/main.jsx`: React entry.
- Create `src/renderer/App.jsx`: desktop shell.
- Create `src/renderer/styles.css`: workstation UI styles.
- Create `src/renderer/services/apiClient.js`: shared server API client.
- Create `src/renderer/features/literature/academicEngines.js`: academic-site URL resolver.
- Create `src/renderer/features/literature/LiteratureHub.jsx`: aggregated search and internal site panel.
- Create `src/renderer/features/import/PdfImportPanel.jsx`: local PDF entry panel.
- Create `src/renderer/features/tasks/TaskCenterPanel.jsx`: task status and notification trigger panel.
- Create `src/renderer/features/offline/OfflineSyncPanel.jsx`: local queue panel.
- Create `tests/apiClient.test.mjs`: API client unit tests.
- Create `tests/academicEngines.test.mjs`: academic engine URL tests.
- Create `tests/localStore.test.mjs`: local store tests.

---

### Task 1: Backend Literature Schemas And Normalization

**Files:**
- Create: `backend/app/schemas/literature.py`
- Create: `backend/app/services/literature_search.py`
- Create: `backend/tests/test_literature_search.py`

- [ ] **Step 1: Write normalization tests**

Create `backend/tests/test_literature_search.py`:

```python
import unittest

from app.services.literature_search import (
    LiteratureResult,
    dedupe_literature_results,
    normalize_arxiv_entry,
    normalize_crossref_work,
    normalize_doi,
    normalize_openalex_work,
    normalize_semantic_scholar_paper,
)


class LiteratureSearchNormalizationTest(unittest.TestCase):
    def test_normalize_doi_strips_url_prefix_and_lowercases(self):
        self.assertEqual(
            normalize_doi("https://doi.org/10.1145/3368089.3409742"),
            "10.1145/3368089.3409742",
        )
        self.assertEqual(normalize_doi(" DOI:10.1000/ABC "), "10.1000/abc")
        self.assertEqual(normalize_doi(""), "")

    def test_openalex_work_becomes_standard_result(self):
        result = normalize_openalex_work(
            {
                "id": "https://openalex.org/W123",
                "display_name": "A Useful Paper",
                "publication_year": 2024,
                "doi": "https://doi.org/10.1000/abc",
                "cited_by_count": 42,
                "authorships": [
                    {"author": {"display_name": "Ada Lovelace"}},
                    {"author": {"display_name": "Grace Hopper"}},
                ],
                "primary_location": {
                    "source": {"display_name": "Journal of Useful Papers"},
                    "pdf_url": "https://example.test/paper.pdf",
                },
                "abstract_inverted_index": {
                    "This": [0],
                    "paper": [1],
                    "works": [2],
                },
            }
        )

        self.assertEqual(result.source, "openalex")
        self.assertEqual(result.title, "A Useful Paper")
        self.assertEqual(result.authors, ["Ada Lovelace", "Grace Hopper"])
        self.assertEqual(result.year, 2024)
        self.assertEqual(result.doi, "10.1000/abc")
        self.assertEqual(result.venue, "Journal of Useful Papers")
        self.assertEqual(result.pdf_url, "https://example.test/paper.pdf")
        self.assertEqual(result.citation_count, 42)
        self.assertEqual(result.abstract, "This paper works")

    def test_crossref_work_becomes_standard_result(self):
        result = normalize_crossref_work(
            {
                "DOI": "10.2000/XYZ",
                "title": ["Crossref Paper"],
                "container-title": ["Conference X"],
                "published-print": {"date-parts": [[2023, 5, 1]]},
                "author": [
                    {"given": "Alan", "family": "Turing"},
                    {"name": "Katherine Johnson"},
                ],
                "URL": "https://doi.org/10.2000/XYZ",
                "abstract": "<jats:p>Clean abstract.</jats:p>",
            }
        )

        self.assertEqual(result.source, "crossref")
        self.assertEqual(result.title, "Crossref Paper")
        self.assertEqual(result.authors, ["Alan Turing", "Katherine Johnson"])
        self.assertEqual(result.year, 2023)
        self.assertEqual(result.doi, "10.2000/xyz")
        self.assertEqual(result.venue, "Conference X")
        self.assertEqual(result.url, "https://doi.org/10.2000/XYZ")
        self.assertEqual(result.abstract, "Clean abstract.")

    def test_arxiv_entry_becomes_standard_result(self):
        result = normalize_arxiv_entry(
            {
                "id": "http://arxiv.org/abs/2401.01234v2",
                "title": "  Arxiv Paper\nTitle ",
                "summary": "A compact summary.",
                "published": "2024-01-02T00:00:00Z",
                "authors": [{"name": "Leslie Lamport"}],
                "links": [
                    {"rel": "alternate", "href": "http://arxiv.org/abs/2401.01234v2"},
                    {"title": "pdf", "href": "http://arxiv.org/pdf/2401.01234v2"},
                ],
            }
        )

        self.assertEqual(result.source, "arxiv")
        self.assertEqual(result.title, "Arxiv Paper Title")
        self.assertEqual(result.authors, ["Leslie Lamport"])
        self.assertEqual(result.year, 2024)
        self.assertEqual(result.arxiv_id, "2401.01234")
        self.assertEqual(result.pdf_url, "http://arxiv.org/pdf/2401.01234v2")

    def test_semantic_scholar_paper_becomes_standard_result(self):
        result = normalize_semantic_scholar_paper(
            {
                "paperId": "abc123",
                "title": "Semantic Paper",
                "abstract": "Useful abstract",
                "year": 2022,
                "citationCount": 12,
                "authors": [{"name": "Barbara Liskov"}],
                "externalIds": {"DOI": "10.3000/SEM", "ArXiv": "2201.11111"},
                "openAccessPdf": {"url": "https://example.test/sem.pdf"},
                "url": "https://semanticscholar.org/paper/abc123",
                "venue": "S2Conf",
            }
        )

        self.assertEqual(result.source, "semantic_scholar")
        self.assertEqual(result.title, "Semantic Paper")
        self.assertEqual(result.authors, ["Barbara Liskov"])
        self.assertEqual(result.year, 2022)
        self.assertEqual(result.doi, "10.3000/sem")
        self.assertEqual(result.arxiv_id, "2201.11111")
        self.assertEqual(result.pdf_url, "https://example.test/sem.pdf")
        self.assertEqual(result.citation_count, 12)

    def test_dedupe_prefers_result_with_pdf_and_citations(self):
        weaker = LiteratureResult(
            source="crossref",
            source_id="crossref:1",
            title="Same Paper",
            authors=["A Author"],
            year=2024,
            doi="10.4000/same",
        )
        stronger = LiteratureResult(
            source="openalex",
            source_id="openalex:1",
            title="Same Paper",
            authors=["A Author"],
            year=2024,
            doi="10.4000/same",
            pdf_url="https://example.test/same.pdf",
            citation_count=9,
        )

        results = dedupe_literature_results([weaker, stronger])

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].source, "openalex")
        self.assertEqual(results[0].pdf_url, "https://example.test/same.pdf")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd C:\Users\xk\Desktop\codexwork\backend
python -m unittest tests.test_literature_search
```

Expected: FAIL with an import error for `app.services.literature_search`.

- [ ] **Step 3: Add literature schemas**

Create `backend/app/schemas/literature.py`:

```python
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
```

- [ ] **Step 4: Add normalization service**

Create `backend/app/services/literature_search.py`:

```python
from __future__ import annotations

import html
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PaperLiteratureCache
from app.schemas.literature import LiteratureSearchResult

DEFAULT_SOURCES = ["openalex", "crossref", "arxiv", "semantic_scholar"]
HTTP_TIMEOUT_SECONDS = 10


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
        )


def compact_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_doi(value: Any) -> str:
    text = compact_text(value).lower()
    text = re.sub(r"^(doi:\s*)", "", text)
    text = re.sub(r"^https?://(dx\.)?doi\.org/", "", text)
    return text.strip()


def normalize_arxiv_id(value: Any) -> str:
    text = compact_text(value)
    text = re.sub(r"^https?://arxiv\.org/(abs|pdf)/", "", text)
    text = re.sub(r"\.pdf$", "", text)
    text = re.sub(r"v\d+$", "", text)
    return text.strip()


def _first_text(value: Any) -> str:
    if isinstance(value, list):
        return compact_text(value[0]) if value else ""
    return compact_text(value)


def _year_from_date_parts(value: Any) -> int | None:
    try:
        return int(value["date-parts"][0][0])
    except Exception:
        return None


def _abstract_from_inverted_index(index: dict[str, list[int]] | None) -> str:
    if not index:
        return ""
    positioned: list[tuple[int, str]] = []
    for word, positions in index.items():
        for position in positions:
            positioned.append((int(position), word))
    return " ".join(word for _, word in sorted(positioned))


def normalize_openalex_work(work: dict[str, Any]) -> LiteratureResult:
    primary_location = work.get("primary_location") or {}
    source = primary_location.get("source") or {}
    authors = [
        compact_text((item.get("author") or {}).get("display_name"))
        for item in work.get("authorships") or []
    ]
    authors = [author for author in authors if author]
    return LiteratureResult(
        source="openalex",
        source_id=compact_text(work.get("id")),
        title=compact_text(work.get("display_name")),
        authors=authors,
        year=work.get("publication_year"),
        venue=compact_text(source.get("display_name")),
        doi=normalize_doi(work.get("doi")),
        abstract=_abstract_from_inverted_index(work.get("abstract_inverted_index")),
        url=compact_text(work.get("id")),
        pdf_url=compact_text(primary_location.get("pdf_url")),
        citation_count=work.get("cited_by_count"),
    )


def normalize_crossref_work(work: dict[str, Any]) -> LiteratureResult:
    authors: list[str] = []
    for author in work.get("author") or []:
        if author.get("name"):
            authors.append(compact_text(author.get("name")))
        else:
            authors.append(compact_text(f"{author.get('given', '')} {author.get('family', '')}"))
    return LiteratureResult(
        source="crossref",
        source_id=normalize_doi(work.get("DOI")) or compact_text(work.get("URL")),
        title=_first_text(work.get("title")),
        authors=[author for author in authors if author],
        year=_year_from_date_parts(work.get("published-print")) or _year_from_date_parts(work.get("published-online")),
        venue=_first_text(work.get("container-title")),
        doi=normalize_doi(work.get("DOI")),
        abstract=compact_text(work.get("abstract")),
        url=compact_text(work.get("URL")),
    )


def normalize_arxiv_entry(entry: dict[str, Any]) -> LiteratureResult:
    links = entry.get("links") or []
    pdf_url = ""
    for link in links:
        if link.get("title") == "pdf" or str(link.get("href", "")).endswith(".pdf"):
            pdf_url = compact_text(link.get("href"))
            break
    published = compact_text(entry.get("published"))
    year = int(published[:4]) if re.match(r"^\d{4}", published) else None
    arxiv_id = normalize_arxiv_id(entry.get("id"))
    return LiteratureResult(
        source="arxiv",
        source_id=arxiv_id,
        title=compact_text(entry.get("title")),
        authors=[compact_text(author.get("name")) for author in entry.get("authors") or [] if compact_text(author.get("name"))],
        year=year,
        venue="arXiv",
        arxiv_id=arxiv_id,
        abstract=compact_text(entry.get("summary")),
        url=compact_text(entry.get("id")),
        pdf_url=pdf_url,
    )


def normalize_semantic_scholar_paper(paper: dict[str, Any]) -> LiteratureResult:
    external = paper.get("externalIds") or {}
    open_pdf = paper.get("openAccessPdf") or {}
    return LiteratureResult(
        source="semantic_scholar",
        source_id=compact_text(paper.get("paperId")),
        title=compact_text(paper.get("title")),
        authors=[compact_text(author.get("name")) for author in paper.get("authors") or [] if compact_text(author.get("name"))],
        year=paper.get("year"),
        venue=compact_text(paper.get("venue")),
        doi=normalize_doi(external.get("DOI")),
        arxiv_id=normalize_arxiv_id(external.get("ArXiv")),
        abstract=compact_text(paper.get("abstract")),
        url=compact_text(paper.get("url")),
        pdf_url=compact_text(open_pdf.get("url")),
        citation_count=paper.get("citationCount"),
    )


def _dedupe_key(result: LiteratureResult) -> str:
    if result.doi:
        return f"doi:{result.doi}"
    if result.arxiv_id:
        return f"arxiv:{result.arxiv_id}"
    normalized_title = re.sub(r"[^a-z0-9]+", " ", result.title.lower()).strip()
    return f"title:{normalized_title}:{result.year or ''}"


def _quality_score(result: LiteratureResult) -> int:
    return (
        int(bool(result.pdf_url)) * 4
        + int(bool(result.abstract)) * 2
        + int(result.citation_count or 0 > 0)
        + int(bool(result.doi))
        + int(bool(result.authors))
    )


def dedupe_literature_results(results: list[LiteratureResult]) -> list[LiteratureResult]:
    selected: dict[str, LiteratureResult] = {}
    for result in results:
        if not result.title:
            continue
        key = _dedupe_key(result)
        current = selected.get(key)
        if current is None or _quality_score(result) > _quality_score(current):
            selected[key] = result
    return sorted(selected.values(), key=lambda item: item.citation_count or 0, reverse=True)


def normalize_sources(sources: list[str] | None) -> list[str]:
    requested = [source for source in (sources or []) if source in DEFAULT_SOURCES]
    return requested or list(DEFAULT_SOURCES)


def cache_key(query: str, sources: list[str], limit: int) -> str:
    normalized_query = compact_text(query).lower()
    return json.dumps({"q": normalized_query, "sources": sorted(sources), "limit": limit}, ensure_ascii=False)
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```powershell
cd C:\Users\xk\Desktop\codexwork\backend
python -m unittest tests.test_literature_search
```

Expected: PASS with 6 tests.

- [ ] **Step 6: Commit backend normalization**

Run:

```powershell
cd C:\Users\xk\Desktop\codexwork
git add backend/app/schemas/literature.py backend/app/services/literature_search.py backend/tests/test_literature_search.py
git commit -m "feat: normalize literature search results"
```

---

### Task 2: Backend Literature Search Route And Cache

**Files:**
- Modify: `backend/app/services/literature_search.py`
- Create: `backend/app/api/routes/literature.py`
- Modify: `backend/app/api/router.py`
- Create: `backend/tests/test_literature_route.py`

- [ ] **Step 1: Write route test**

Create `backend/tests/test_literature_route.py`:

```python
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db.session import Base, get_db
from app.main import app
from app.models import User
from app.services.literature_search import LiteratureResult


class LiteratureRouteTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

        def fake_user():
            return User(id=1, uid="test-user", email="test@example.com", password_hash="x", status="active")

        def fake_db():
            yield None

        app.dependency_overrides[get_current_user] = fake_user
        app.dependency_overrides[get_db] = fake_db

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_search_endpoint_returns_normalized_results(self):
        with patch("app.api.routes.literature.search_literature") as search:
            search.return_value = (
                [
                    LiteratureResult(
                        source="openalex",
                        source_id="W1",
                        title="Desktop Search Paper",
                        authors=["A Author"],
                        year=2026,
                        doi="10.5000/desktop",
                        pdf_url="https://example.test/desktop.pdf",
                    )
                ],
                ["openalex"],
                False,
            )

            response = self.client.get("/api/literature/search?q=desktop&limit=5")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["query"], "desktop")
        self.assertEqual(payload["sources"], ["openalex"])
        self.assertFalse(payload["cached"])
        self.assertEqual(payload["results"][0]["title"], "Desktop Search Paper")
        self.assertEqual(payload["results"][0]["doi"], "10.5000/desktop")

    def test_search_endpoint_rejects_blank_query(self):
        response = self.client.get("/api/literature/search?q=%20%20")

        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run route test to verify it fails**

Run:

```powershell
cd C:\Users\xk\Desktop\codexwork\backend
python -m unittest tests.test_literature_route
```

Expected: FAIL because `app.api.routes.literature` and `/api/literature/search` do not exist.

- [ ] **Step 3: Extend literature search service with source fetchers and cache**

Append this code to `backend/app/services/literature_search.py`:

```python
def _read_json(url: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    request = urllib.request.Request(url, headers=headers or {"User-Agent": "PaperReader/desktop-search"})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def _read_arxiv_entries(url: str) -> list[dict[str, Any]]:
    request = urllib.request.Request(url, headers={"User-Agent": "PaperReader/desktop-search"})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
        root = ET.fromstring(response.read().decode("utf-8"))
    namespace = {"atom": "http://www.w3.org/2005/Atom"}
    entries: list[dict[str, Any]] = []
    for entry in root.findall("atom:entry", namespace):
        entries.append(
            {
                "id": compact_text(entry.findtext("atom:id", default="", namespaces=namespace)),
                "title": compact_text(entry.findtext("atom:title", default="", namespaces=namespace)),
                "summary": compact_text(entry.findtext("atom:summary", default="", namespaces=namespace)),
                "published": compact_text(entry.findtext("atom:published", default="", namespaces=namespace)),
                "authors": [
                    {"name": compact_text(author.findtext("atom:name", default="", namespaces=namespace))}
                    for author in entry.findall("atom:author", namespace)
                ],
                "links": [link.attrib for link in entry.findall("atom:link", namespace)],
            }
        )
    return entries


def fetch_openalex(query: str, limit: int) -> list[LiteratureResult]:
    params = urllib.parse.urlencode({"search": query, "per-page": min(limit, 25)})
    payload = _read_json(f"https://api.openalex.org/works?{params}")
    return [normalize_openalex_work(item) for item in payload.get("results") or []]


def fetch_crossref(query: str, limit: int) -> list[LiteratureResult]:
    params = urllib.parse.urlencode({"query": query, "rows": min(limit, 25)})
    payload = _read_json(f"https://api.crossref.org/works?{params}")
    items = ((payload.get("message") or {}).get("items") or [])
    return [normalize_crossref_work(item) for item in items]


def fetch_arxiv(query: str, limit: int) -> list[LiteratureResult]:
    params = urllib.parse.urlencode(
        {
            "search_query": f"all:{query}",
            "start": 0,
            "max_results": min(limit, 25),
        }
    )
    entries = _read_arxiv_entries(f"https://export.arxiv.org/api/query?{params}")
    return [normalize_arxiv_entry(entry) for entry in entries]


def fetch_semantic_scholar(query: str, limit: int) -> list[LiteratureResult]:
    fields = "title,abstract,year,citationCount,authors,externalIds,openAccessPdf,url,venue"
    params = urllib.parse.urlencode({"query": query, "limit": min(limit, 20), "fields": fields})
    payload = _read_json(f"https://api.semanticscholar.org/graph/v1/paper/search?{params}")
    return [normalize_semantic_scholar_paper(item) for item in payload.get("data") or []]


SOURCE_FETCHERS = {
    "openalex": fetch_openalex,
    "crossref": fetch_crossref,
    "arxiv": fetch_arxiv,
    "semantic_scholar": fetch_semantic_scholar,
}


def _load_cached_results(db: Session | None, key: str) -> list[LiteratureResult] | None:
    if db is None:
        return None
    cached = db.scalar(
        select(PaperLiteratureCache).where(
            PaperLiteratureCache.result_kind == "search",
            PaperLiteratureCache.lookup_key == key,
        )
    )
    if not cached:
        return None
    return [LiteratureResult(**item) for item in cached.payload_json]


def _store_cached_results(db: Session | None, key: str, results: list[LiteratureResult]) -> None:
    if db is None:
        return
    payload = [result.__dict__ for result in results]
    cached = db.scalar(
        select(PaperLiteratureCache).where(
            PaperLiteratureCache.result_kind == "search",
            PaperLiteratureCache.lookup_key == key,
        )
    )
    if cached:
        cached.payload_json = payload
        cached.updated_at = datetime.now(timezone.utc)
    else:
        db.add(
            PaperLiteratureCache(
                result_kind="search",
                lookup_key=key,
                source=",".join(DEFAULT_SOURCES),
                payload_json=payload,
            )
        )
    db.commit()


def search_literature(
    query: str,
    *,
    limit: int = 20,
    sources: list[str] | None = None,
    db: Session | None = None,
) -> tuple[list[LiteratureResult], list[str], bool]:
    selected_sources = normalize_sources(sources)
    key = cache_key(query, selected_sources, limit)
    cached = _load_cached_results(db, key)
    if cached is not None:
        return cached[:limit], selected_sources, True

    collected: list[LiteratureResult] = []
    for source in selected_sources:
        fetcher = SOURCE_FETCHERS[source]
        try:
            collected.extend(fetcher(query, limit))
        except Exception:
            continue

    results = dedupe_literature_results(collected)[:limit]
    _store_cached_results(db, key, results)
    return results, selected_sources, False
```

- [ ] **Step 4: Create literature route**

Create `backend/app/api/routes/literature.py`:

```python
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.literature import LiteratureSearchResponse
from app.services.literature_search import compact_text, search_literature

router = APIRouter(prefix="/literature", tags=["literature"])


@router.get("/search", response_model=LiteratureSearchResponse)
def search_literature_endpoint(
    q: Annotated[str, Query(min_length=1, max_length=300)],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    sources: Annotated[list[str] | None, Query()] = None,
) -> LiteratureSearchResponse:
    query = compact_text(q)
    results, selected_sources, cached = search_literature(query, limit=limit, sources=sources, db=db)
    return LiteratureSearchResponse(
        query=query,
        sources=selected_sources,
        cached=cached,
        results=[result.to_schema() for result in results],
    )
```

- [ ] **Step 5: Mount route**

Modify `backend/app/api/router.py`:

```python
from app.api.routes.literature import router as literature_router
```

Add the include near the other domain routers:

```python
api_router.include_router(literature_router, tags=["literature"])
```

- [ ] **Step 6: Run backend route tests**

Run:

```powershell
cd C:\Users\xk\Desktop\codexwork\backend
python -m unittest tests.test_literature_search tests.test_literature_route
```

Expected: PASS for both test modules.

- [ ] **Step 7: Commit backend route**

Run:

```powershell
cd C:\Users\xk\Desktop\codexwork
git add backend/app/api/router.py backend/app/api/routes/literature.py backend/app/services/literature_search.py backend/tests/test_literature_route.py
git commit -m "feat: add literature search api"
```

---

### Task 3: Desktop Project Scaffold

**Files:**
- Create directory: `C:/Users/xk/Desktop/paper-reader-desktop`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/package.json`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/index.html`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/vite.config.js`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/main/main.js`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/main/createWindow.js`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/preload/index.js`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/main.jsx`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/App.jsx`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/styles.css`

- [ ] **Step 1: Create project folders**

Run:

```powershell
New-Item -ItemType Directory -Force `
  C:\Users\xk\Desktop\paper-reader-desktop\src\main, `
  C:\Users\xk\Desktop\paper-reader-desktop\src\preload, `
  C:\Users\xk\Desktop\paper-reader-desktop\src\renderer, `
  C:\Users\xk\Desktop\paper-reader-desktop\tests
```

Expected: directories exist outside `C:\Users\xk\Desktop\codexwork`.

- [ ] **Step 2: Create package manifest**

Create `C:/Users/xk/Desktop/paper-reader-desktop/package.json`:

```json
{
  "name": "paper-reader-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/main/main.js",
  "scripts": {
    "dev": "concurrently -k \"vite --host 127.0.0.1\" \"wait-on http://127.0.0.1:5173 && cross-env VITE_DEV_SERVER_URL=http://127.0.0.1:5173 electron .\"",
    "build": "vite build",
    "start": "electron .",
    "test": "node --test \"tests/**/*.test.mjs\""
  },
  "dependencies": {
    "@vitejs/plugin-react": "^6.0.1",
    "electron": "^41.5.0",
    "lucide-react": "^1.14.0",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "vite": "^8.0.10"
  },
  "devDependencies": {
    "concurrently": "^9.2.1",
    "cross-env": "^10.1.0",
    "wait-on": "^9.0.3"
  }
}
```

- [ ] **Step 3: Create Vite files**

Create `C:/Users/xk/Desktop/paper-reader-desktop/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Paper Reader Desktop</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.jsx"></script>
  </body>
</html>
```

Create `C:/Users/xk/Desktop/paper-reader-desktop/vite.config.js`:

```js
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
```

- [ ] **Step 4: Create secure Electron window**

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/main/createWindow.js`:

```js
import { BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..')

export function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: 'Paper Reader Desktop',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(projectRoot, 'src', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    window.loadFile(path.join(projectRoot, 'dist', 'index.html'))
  }

  return window
}
```

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/main/main.js`:

```js
import { app } from 'electron'
import { createMainWindow } from './createWindow.js'

let mainWindow = null

app.whenReady().then(() => {
  mainWindow = createMainWindow()

  app.on('activate', () => {
    if (mainWindow === null) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

- [ ] **Step 5: Create initial preload bridge**

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/preload/index.js`:

```js
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('paperDesktop', {
  platform: process.platform,
})
```

- [ ] **Step 6: Create renderer shell**

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/main.jsx`:

```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/App.jsx`:

```jsx
export function App() {
  return (
    <main className="app-shell">
      <aside className="left-rail">
        <strong>Paper</strong>
        <button type="button" className="rail-item is-active">检索</button>
        <button type="button" className="rail-item">文献</button>
        <button type="button" className="rail-item">任务</button>
        <button type="button" className="rail-item">设置</button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>桌面文献工作台</h1>
            <p>连接同一个服务器后端，增强本地入口、检索和任务体验。</p>
          </div>
          <span className="status-pill">Windows first</span>
        </header>
        <section className="empty-state">
          <h2>Phase 1 shell</h2>
          <p>下一步接入检索、PDF 导入、本地缓存和任务通知。</p>
        </section>
      </section>
    </main>
  )
}
```

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/styles.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "Segoe UI", system-ui, sans-serif;
  color: #111827;
  background: #f8fafc;
}

button,
input,
select {
  font: inherit;
}

.app-shell {
  display: grid;
  grid-template-columns: 76px 1fr;
  min-height: 100vh;
}

.left-rail {
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 14px 8px;
  border-right: 1px solid #e5e7eb;
  background: #ffffff;
}

.rail-item {
  border: 0;
  border-radius: 6px;
  padding: 10px 6px;
  background: transparent;
  color: #475569;
  cursor: pointer;
}

.rail-item.is-active {
  background: #e0f2fe;
  color: #075985;
}

.workspace {
  display: grid;
  grid-template-rows: auto 1fr;
  min-width: 0;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
}

.topbar h1 {
  margin: 0;
  font-size: 20px;
}

.topbar p {
  margin: 4px 0 0;
  color: #64748b;
}

.status-pill {
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  padding: 6px 10px;
  color: #1d4ed8;
  background: #eff6ff;
}

.empty-state {
  align-self: center;
  justify-self: center;
  max-width: 520px;
  text-align: center;
  color: #475569;
}
```

- [ ] **Step 7: Install and verify shell build**

Run:

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
npm install
npm run build
```

Expected: `vite build` exits with code 0 and creates `dist/index.html`.

- [ ] **Step 8: Create desktop repository commit**

Run:

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
git init
git add .
git commit -m "feat: scaffold desktop client shell"
```

---

### Task 4: Desktop API Client And Literature Hub

**Files:**
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/services/apiClient.js`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/features/literature/academicEngines.js`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/features/literature/LiteratureHub.jsx`
- Modify: `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/App.jsx`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/tests/apiClient.test.mjs`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/tests/academicEngines.test.mjs`

- [ ] **Step 1: Write API client test**

Create `C:/Users/xk/Desktop/paper-reader-desktop/tests/apiClient.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createApiClient } from '../src/renderer/services/apiClient.js'

test('searchLiterature calls shared backend literature endpoint', async () => {
  const requests = []
  const client = createApiClient({
    baseUrl: 'https://paper.example.test/api',
    token: 'token-123',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init })
      return {
        ok: true,
        json: async () => ({
          query: 'graph neural networks',
          sources: ['openalex'],
          cached: false,
          results: [{ title: 'Graph Paper', source: 'openalex', source_id: 'W1', authors: [] }],
        }),
      }
    },
  })

  const payload = await client.searchLiterature('graph neural networks', { limit: 5, sources: ['openalex'] })

  assert.equal(payload.results[0].title, 'Graph Paper')
  assert.equal(requests[0].url, 'https://paper.example.test/api/literature/search?q=graph+neural+networks&limit=5&sources=openalex')
  assert.equal(requests[0].init.headers.Authorization, 'Bearer token-123')
})

test('api client surfaces backend errors with status code', async () => {
  const client = createApiClient({
    baseUrl: 'https://paper.example.test/api',
    token: '',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    }),
  })

  await assert.rejects(
    () => client.searchLiterature('x'),
    /Request failed with 401: unauthorized/,
  )
})
```

- [ ] **Step 2: Write academic engine tests**

Create `C:/Users/xk/Desktop/paper-reader-desktop/tests/academicEngines.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { ACADEMIC_ENGINES, resolveAcademicSearchUrl } from '../src/renderer/features/literature/academicEngines.js'

test('academic engines include the first desktop sources', () => {
  assert.deepEqual(
    ACADEMIC_ENGINES.map((engine) => engine.id),
    ['cnki', 'wanfang', 'webofscience', 'pubmed', 'semantic_scholar', 'arxiv'],
  )
})

test('resolveAcademicSearchUrl encodes query', () => {
  assert.equal(
    resolveAcademicSearchUrl('pubmed', 'cancer immunotherapy'),
    'https://pubmed.ncbi.nlm.nih.gov/?term=cancer+immunotherapy',
  )
  assert.equal(
    resolveAcademicSearchUrl('arxiv', 'large language model'),
    'https://arxiv.org/search/?query=large+language+model&searchtype=all',
  )
})

test('resolveAcademicSearchUrl rejects unknown engine', () => {
  assert.throws(() => resolveAcademicSearchUrl('unknown', 'x'), /Unknown academic engine/)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
npm test
```

Expected: FAIL with module-not-found errors.

- [ ] **Step 4: Add API client**

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/services/apiClient.js`:

```js
function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

async function readResponse(response) {
  if (response.ok) return response.json()
  const text = await response.text()
  throw new Error(`Request failed with ${response.status}: ${text}`)
}

export function createApiClient({ baseUrl, token, fetchImpl = fetch }) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  return {
    async health() {
      const response = await fetchImpl(joinUrl(baseUrl, '/health'), { headers })
      return readResponse(response)
    },

    async searchLiterature(query, { limit = 20, sources = [] } = {}) {
      const params = new URLSearchParams()
      params.set('q', query)
      params.set('limit', String(limit))
      for (const source of sources) params.append('sources', source)
      const response = await fetchImpl(joinUrl(baseUrl, `/literature/search?${params}`), { headers })
      return readResponse(response)
    },
  }
}
```

- [ ] **Step 5: Add academic engines**

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/features/literature/academicEngines.js`:

```js
export const ACADEMIC_ENGINES = [
  {
    id: 'cnki',
    label: '知网',
    buildUrl: (query) => `https://kns.cnki.net/kns8s/defaultresult/index?kw=${encodeURIComponent(query)}`,
  },
  {
    id: 'wanfang',
    label: '万方',
    buildUrl: (query) => `https://s.wanfangdata.com.cn/paper?q=${encodeURIComponent(query)}`,
  },
  {
    id: 'webofscience',
    label: 'Web of Science',
    buildUrl: (query) => `https://www.webofscience.com/wos/woscc/basic-search?search_mode=BasicSearch&value(input1)=${encodeURIComponent(query)}`,
  },
  {
    id: 'pubmed',
    label: 'PubMed',
    buildUrl: (query) => `https://pubmed.ncbi.nlm.nih.gov/?term=${new URLSearchParams({ term: query }).get('term')}`,
  },
  {
    id: 'semantic_scholar',
    label: 'Semantic Scholar',
    buildUrl: (query) => `https://www.semanticscholar.org/search?q=${encodeURIComponent(query)}`,
  },
  {
    id: 'arxiv',
    label: 'arXiv',
    buildUrl: (query) => `https://arxiv.org/search/?query=${new URLSearchParams({ query }).get('query')}&searchtype=all`,
  },
]

export function resolveAcademicSearchUrl(engineId, query) {
  const engine = ACADEMIC_ENGINES.find((item) => item.id === engineId)
  if (!engine) throw new Error(`Unknown academic engine: ${engineId}`)
  return engine.buildUrl(query)
}
```

- [ ] **Step 6: Add LiteratureHub UI**

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/features/literature/LiteratureHub.jsx`:

```jsx
import { useMemo, useState } from 'react'
import { createApiClient } from '../../services/apiClient.js'
import { ACADEMIC_ENGINES, resolveAcademicSearchUrl } from './academicEngines.js'

const DEFAULT_API_BASE = 'http://127.0.0.1:8000/api'

export function LiteratureHub() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE)
  const [token, setToken] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [activeEngine, setActiveEngine] = useState('cnki')
  const [browserUrl, setBrowserUrl] = useState('')
  const [status, setStatus] = useState('输入关键词开始检索')

  const api = useMemo(() => createApiClient({ baseUrl: apiBase, token }), [apiBase, token])

  async function runAggregatedSearch(event) {
    event.preventDefault()
    const cleanQuery = query.trim()
    if (!cleanQuery) return
    setStatus('正在请求后端聚合检索...')
    try {
      const payload = await api.searchLiterature(cleanQuery, {
        sources: ['openalex', 'crossref', 'arxiv', 'semantic_scholar'],
        limit: 20,
      })
      setResults(payload.results || [])
      setStatus(payload.cached ? '已显示缓存结果' : '已显示最新聚合结果')
    } catch (error) {
      setStatus(error.message)
    }
  }

  function openAcademicEngine(engineId = activeEngine) {
    const cleanQuery = query.trim()
    if (!cleanQuery) return
    setActiveEngine(engineId)
    setBrowserUrl(resolveAcademicSearchUrl(engineId, cleanQuery))
  }

  return (
    <section className="literature-hub">
      <aside className="engine-sidebar">
        <button type="button" className="engine-item is-active">聚合检索</button>
        {ACADEMIC_ENGINES.map((engine) => (
          <button
            key={engine.id}
            type="button"
            className={`engine-item ${engine.id === activeEngine ? 'is-selected' : ''}`}
            onClick={() => openAcademicEngine(engine.id)}
          >
            {engine.label}
          </button>
        ))}
      </aside>

      <section className="hub-main">
        <form className="searchbar" onSubmit={runAggregatedSearch}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主题、标题、作者、DOI" />
          <button type="submit">聚合检索</button>
          <button type="button" onClick={() => openAcademicEngine(activeEngine)}>站点打开</button>
        </form>

        <div className="server-row">
          <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} aria-label="API base URL" />
          <input value={token} onChange={(event) => setToken(event.target.value)} aria-label="Access token" placeholder="Bearer token" />
        </div>

        <div className="status-line">{status}</div>

        <div className="result-list">
          {results.map((result) => (
            <article className="result-item" key={`${result.source}:${result.source_id}`}>
              <div>
                <strong>{result.title}</strong>
                <p>{(result.authors || []).join(', ') || '未知作者'} · {result.year || '未知年份'} · {result.venue || result.source}</p>
                <p>{result.abstract || '暂无摘要'}</p>
              </div>
              <div className="result-actions">
                {result.pdf_url && <a href={result.pdf_url}>PDF</a>}
                <button type="button">导入</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="site-browser">
        <header>
          <strong>内置学术站点</strong>
          <span>{ACADEMIC_ENGINES.find((engine) => engine.id === activeEngine)?.label}</span>
        </header>
        {browserUrl ? (
          <webview src={browserUrl} className="academic-webview" />
        ) : (
          <div className="browser-empty">选择一个站点并输入关键词。</div>
        )}
      </aside>
    </section>
  )
}
```

- [ ] **Step 7: Mount LiteratureHub in App**

Replace `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/App.jsx` with:

```jsx
import { LiteratureHub } from './features/literature/LiteratureHub.jsx'

export function App() {
  return (
    <main className="app-shell">
      <aside className="left-rail">
        <strong>Paper</strong>
        <button type="button" className="rail-item is-active">检索</button>
        <button type="button" className="rail-item">文献</button>
        <button type="button" className="rail-item">任务</button>
        <button type="button" className="rail-item">设置</button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>桌面文献工作台</h1>
            <p>聚合检索与内置学术站点浏览在同一个窗口里完成。</p>
          </div>
          <span className="status-pill">Shared backend</span>
        </header>
        <LiteratureHub />
      </section>
    </main>
  )
}
```

- [ ] **Step 8: Add CSS for hub**

Append to `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/styles.css`:

```css
.literature-hub {
  display: grid;
  grid-template-columns: 210px minmax(420px, 1fr) 360px;
  min-height: 0;
}

.engine-sidebar,
.site-browser {
  border-right: 1px solid #e5e7eb;
  background: #ffffff;
  padding: 12px;
}

.site-browser {
  border-right: 0;
  border-left: 1px solid #e5e7eb;
}

.engine-item {
  display: block;
  width: 100%;
  margin-bottom: 8px;
  border: 0;
  border-radius: 6px;
  padding: 9px 10px;
  text-align: left;
  color: #475569;
  background: transparent;
  cursor: pointer;
}

.engine-item.is-active,
.engine-item.is-selected {
  background: #f1f5f9;
  color: #0f172a;
}

.hub-main {
  min-width: 0;
  padding: 16px;
  overflow: auto;
}

.searchbar,
.server-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  margin-bottom: 10px;
}

.server-row {
  grid-template-columns: 1fr 1fr;
}

.searchbar input,
.server-row input {
  min-width: 0;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 9px 10px;
}

.searchbar button,
.result-actions button {
  border: 1px solid #bae6fd;
  border-radius: 6px;
  padding: 9px 12px;
  color: #0369a1;
  background: #f0f9ff;
  cursor: pointer;
}

.status-line {
  margin: 8px 0 12px;
  color: #64748b;
}

.result-list {
  display: grid;
  gap: 10px;
}

.result-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px;
  background: #ffffff;
}

.result-item p {
  margin: 6px 0 0;
  color: #475569;
}

.result-actions {
  display: grid;
  align-content: start;
  gap: 8px;
}

.site-browser header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  color: #334155;
}

.academic-webview,
.browser-empty {
  width: 100%;
  height: calc(100vh - 116px);
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
}

.browser-empty {
  display: grid;
  place-items: center;
  padding: 18px;
  color: #64748b;
  text-align: center;
}
```

- [ ] **Step 9: Run desktop tests and build**

Run:

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
npm test
npm run build
```

Expected: tests pass and build exits with code 0.

- [ ] **Step 10: Commit literature hub**

Run:

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
git add .
git commit -m "feat: add literature discovery hub"
```

---

### Task 5: Local Store, PDF Entry, And Notifications

**Files:**
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/main/localStore.js`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/main/ipc.js`
- Modify: `C:/Users/xk/Desktop/paper-reader-desktop/src/main/main.js`
- Modify: `C:/Users/xk/Desktop/paper-reader-desktop/src/preload/index.js`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/features/import/PdfImportPanel.jsx`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/features/tasks/TaskCenterPanel.jsx`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/features/offline/OfflineSyncPanel.jsx`
- Modify: `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/App.jsx`
- Create: `C:/Users/xk/Desktop/paper-reader-desktop/tests/localStore.test.mjs`

- [ ] **Step 1: Write local store test**

Create `C:/Users/xk/Desktop/paper-reader-desktop/tests/localStore.test.mjs`:

```js
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createLocalStore } from '../src/main/localStore.js'

test('local store persists recent PDFs and sync queue', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-desktop-store-'))
  const store = createLocalStore({ dataDir: dir })

  await store.addRecentPdf('C:/papers/a.pdf')
  await store.enqueueSyncItem({ type: 'reading-progress', paperId: 7, payload: { page: 3 } })

  const reloaded = createLocalStore({ dataDir: dir })
  const snapshot = await reloaded.readSnapshot()

  assert.deepEqual(snapshot.recentPdfs, ['C:/papers/a.pdf'])
  assert.equal(snapshot.syncQueue.length, 1)
  assert.equal(snapshot.syncQueue[0].type, 'reading-progress')
  assert.equal(snapshot.syncQueue[0].paperId, 7)
})

test('local store keeps most recent PDF first and removes duplicates', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-desktop-store-'))
  const store = createLocalStore({ dataDir: dir })

  await store.addRecentPdf('C:/papers/a.pdf')
  await store.addRecentPdf('C:/papers/b.pdf')
  await store.addRecentPdf('C:/papers/a.pdf')

  const snapshot = await store.readSnapshot()

  assert.deepEqual(snapshot.recentPdfs, ['C:/papers/a.pdf', 'C:/papers/b.pdf'])
})
```

- [ ] **Step 2: Run local store test to verify it fails**

Run:

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
npm test
```

Expected: FAIL with module-not-found error for `src/main/localStore.js`.

- [ ] **Step 3: Add local store**

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/main/localStore.js`:

```js
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const STORE_FILE = 'paper-desktop-store.json'

const DEFAULT_SNAPSHOT = {
  recentPdfs: [],
  syncQueue: [],
  taskNotifications: [],
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

export function createLocalStore({ dataDir }) {
  const filePath = path.join(dataDir, STORE_FILE)

  async function readSnapshot() {
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      return { ...DEFAULT_SNAPSHOT, ...JSON.parse(raw) }
    } catch (error) {
      if (error.code === 'ENOENT') return { ...DEFAULT_SNAPSHOT }
      throw error
    }
  }

  async function writeSnapshot(snapshot) {
    await ensureDir(dataDir)
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8')
    return snapshot
  }

  return {
    readSnapshot,

    async addRecentPdf(pdfPath) {
      const snapshot = await readSnapshot()
      const recentPdfs = [pdfPath, ...snapshot.recentPdfs.filter((item) => item !== pdfPath)].slice(0, 50)
      return writeSnapshot({ ...snapshot, recentPdfs })
    },

    async enqueueSyncItem(item) {
      const snapshot = await readSnapshot()
      const syncQueue = [
        ...snapshot.syncQueue,
        {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          status: 'pending',
          ...item,
        },
      ]
      return writeSnapshot({ ...snapshot, syncQueue })
    },

    async rememberTaskNotification(task) {
      const snapshot = await readSnapshot()
      const taskNotifications = [
        {
          id: task.id,
          title: task.title,
          status: task.status,
          createdAt: new Date().toISOString(),
        },
        ...snapshot.taskNotifications.filter((item) => item.id !== task.id),
      ].slice(0, 100)
      return writeSnapshot({ ...snapshot, taskNotifications })
    },
  }
}
```

- [ ] **Step 4: Add IPC handlers**

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/main/ipc.js`:

```js
import { Notification, dialog, ipcMain, app } from 'electron'
import { createLocalStore } from './localStore.js'

export function registerIpcHandlers() {
  const store = createLocalStore({ dataDir: app.getPath('userData') })

  ipcMain.handle('files:selectPdfs', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 PDF 文献',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF files', extensions: ['pdf'] }],
    })
    if (result.canceled) return []
    for (const filePath of result.filePaths) {
      await store.addRecentPdf(filePath)
    }
    return result.filePaths
  })

  ipcMain.handle('files:rememberPdfs', async (_event, filePaths) => {
    const safePaths = Array.isArray(filePaths) ? filePaths.filter((item) => String(item).toLowerCase().endsWith('.pdf')) : []
    for (const filePath of safePaths) {
      await store.addRecentPdf(filePath)
    }
    return safePaths
  })

  ipcMain.handle('localStore:readSnapshot', async () => store.readSnapshot())

  ipcMain.handle('syncQueue:enqueue', async (_event, item) => {
    await store.enqueueSyncItem(item)
    return store.readSnapshot()
  })

  ipcMain.handle('notifications:taskComplete', async (_event, task) => {
    await store.rememberTaskNotification(task)
    if (Notification.isSupported()) {
      new Notification({
        title: task.title || '任务已完成',
        body: task.body || '服务器任务已经处理完成。',
      }).show()
    }
    return store.readSnapshot()
  })
}
```

Modify `C:/Users/xk/Desktop/paper-reader-desktop/src/main/main.js`:

```js
import { app } from 'electron'
import { createMainWindow } from './createWindow.js'
import { registerIpcHandlers } from './ipc.js'

let mainWindow = null

app.whenReady().then(() => {
  registerIpcHandlers()
  mainWindow = createMainWindow()

  app.on('activate', () => {
    if (mainWindow === null) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

- [ ] **Step 5: Extend preload bridge**

Replace `C:/Users/xk/Desktop/paper-reader-desktop/src/preload/index.js` with:

```js
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('paperDesktop', {
  platform: process.platform,
  files: {
    selectPdfs: () => ipcRenderer.invoke('files:selectPdfs'),
    rememberPdfs: (filePaths) => ipcRenderer.invoke('files:rememberPdfs', filePaths),
    getPathForFile: (file) => webUtils.getPathForFile(file),
  },
  localStore: {
    readSnapshot: () => ipcRenderer.invoke('localStore:readSnapshot'),
  },
  syncQueue: {
    enqueue: (item) => ipcRenderer.invoke('syncQueue:enqueue', item),
  },
  notifications: {
    taskComplete: (task) => ipcRenderer.invoke('notifications:taskComplete', task),
  },
})
```

- [ ] **Step 6: Add PDF import panel**

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/features/import/PdfImportPanel.jsx`:

```jsx
import { useState } from 'react'

export function PdfImportPanel() {
  const [paths, setPaths] = useState([])
  const [message, setMessage] = useState('选择或拖入 PDF 文件')

  async function selectPdfs() {
    const selected = await window.paperDesktop.files.selectPdfs()
    setPaths(selected)
    setMessage(selected.length ? `已加入 ${selected.length} 个 PDF` : '没有选择文件')
  }

  async function handleDrop(event) {
    event.preventDefault()
    const pdfPaths = [...event.dataTransfer.files]
      .map((file) => window.paperDesktop.files.getPathForFile(file))
      .filter((filePath) => filePath.toLowerCase().endsWith('.pdf'))
    const remembered = await window.paperDesktop.files.rememberPdfs(pdfPaths)
    setPaths(remembered)
    setMessage(remembered.length ? `已加入 ${remembered.length} 个 PDF` : '拖入的文件不是 PDF')
  }

  return (
    <section className="desktop-panel" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
      <header>
        <strong>本地 PDF 入口</strong>
        <button type="button" onClick={selectPdfs}>选择 PDF</button>
      </header>
      <p>{message}</p>
      <ul>
        {paths.map((filePath) => <li key={filePath}>{filePath}</li>)}
      </ul>
    </section>
  )
}
```

- [ ] **Step 7: Add task notification panel**

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/features/tasks/TaskCenterPanel.jsx`:

```jsx
import { useState } from 'react'

export function TaskCenterPanel() {
  const [message, setMessage] = useState('等待服务器任务')

  async function simulateCompleteTask() {
    await window.paperDesktop.notifications.taskComplete({
      id: `demo-${Date.now()}`,
      title: '全文翻译完成',
      status: 'completed',
      body: '可以回到阅读器查看结果。',
    })
    setMessage('已发送 Windows 任务完成通知')
  }

  return (
    <section className="desktop-panel">
      <header>
        <strong>任务中心</strong>
        <button type="button" onClick={simulateCompleteTask}>测试通知</button>
      </header>
      <p>{message}</p>
    </section>
  )
}
```

- [ ] **Step 8: Add offline queue panel**

Create `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/features/offline/OfflineSyncPanel.jsx`:

```jsx
import { useEffect, useState } from 'react'

export function OfflineSyncPanel() {
  const [snapshot, setSnapshot] = useState({ recentPdfs: [], syncQueue: [] })

  async function refresh() {
    setSnapshot(await window.paperDesktop.localStore.readSnapshot())
  }

  async function enqueueDemoProgress() {
    const next = await window.paperDesktop.syncQueue.enqueue({
      type: 'reading-progress',
      paperId: 1,
      payload: { page: 1, scale: 1 },
    })
    setSnapshot(next)
  }

  useEffect(() => {
    refresh()
  }, [])

  return (
    <section className="desktop-panel">
      <header>
        <strong>离线同步队列</strong>
        <button type="button" onClick={enqueueDemoProgress}>加入阅读进度</button>
      </header>
      <p>最近 PDF：{snapshot.recentPdfs.length} 个；待同步：{snapshot.syncQueue.length} 条</p>
    </section>
  )
}
```

- [ ] **Step 9: Mount desktop panels**

Modify `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/App.jsx`:

```jsx
import { PdfImportPanel } from './features/import/PdfImportPanel.jsx'
import { LiteratureHub } from './features/literature/LiteratureHub.jsx'
import { OfflineSyncPanel } from './features/offline/OfflineSyncPanel.jsx'
import { TaskCenterPanel } from './features/tasks/TaskCenterPanel.jsx'

export function App() {
  return (
    <main className="app-shell">
      <aside className="left-rail">
        <strong>Paper</strong>
        <button type="button" className="rail-item is-active">检索</button>
        <button type="button" className="rail-item">文献</button>
        <button type="button" className="rail-item">任务</button>
        <button type="button" className="rail-item">设置</button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>桌面文献工作台</h1>
            <p>聚合检索、内置站点、本地 PDF、离线队列和任务通知。</p>
          </div>
          <span className="status-pill">Shared backend</span>
        </header>
        <section className="desktop-grid">
          <LiteratureHub />
          <aside className="desktop-side">
            <PdfImportPanel />
            <OfflineSyncPanel />
            <TaskCenterPanel />
          </aside>
        </section>
      </section>
    </main>
  )
}
```

Append to `C:/Users/xk/Desktop/paper-reader-desktop/src/renderer/styles.css`:

```css
.desktop-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  min-height: 0;
}

.desktop-grid .literature-hub {
  grid-template-columns: 190px minmax(360px, 1fr) 320px;
}

.desktop-side {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 12px;
  border-left: 1px solid #e5e7eb;
  background: #f8fafc;
}

.desktop-panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  background: #ffffff;
}

.desktop-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.desktop-panel button {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 6px 8px;
  background: #ffffff;
  cursor: pointer;
}

.desktop-panel p {
  color: #64748b;
}

.desktop-panel ul {
  max-height: 120px;
  overflow: auto;
  padding-left: 18px;
}
```

- [ ] **Step 10: Run desktop tests and build**

Run:

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
npm test
npm run build
```

Expected: tests pass and build exits with code 0.

- [ ] **Step 11: Commit desktop native bridge**

Run:

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
git add .
git commit -m "feat: add desktop native bridge"
```

---

### Task 6: End-To-End Verification

**Files:**
- Modify: `C:/Users/xk/Desktop/paper-reader-desktop/README.md`

- [ ] **Step 1: Add desktop README**

Create `C:/Users/xk/Desktop/paper-reader-desktop/README.md`:

```markdown
# Paper Reader Desktop

Windows-first desktop client for Paper Reader.

## Development

```powershell
npm install
npm run dev
```

## Checks

```powershell
npm test
npm run build
```

## Backend

The default API base is `http://127.0.0.1:8000/api`. Use the API base field in the desktop UI to point at another shared server.

The desktop client is independent from the existing web frontend. It shares the same FastAPI backend.
```

- [ ] **Step 2: Verify backend tests**

Run:

```powershell
cd C:\Users\xk\Desktop\codexwork\backend
python -m unittest tests.test_literature_search tests.test_literature_route
```

Expected: PASS for both literature test modules.

- [ ] **Step 3: Verify desktop tests and build**

Run:

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
npm test
npm run build
```

Expected: Node tests pass and Vite build exits with code 0.

- [ ] **Step 4: Smoke-run desktop app**

Run:

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
npm run dev
```

Expected:

- Electron window opens.
- Literature hub renders.
- Academic engine buttons create internal webview URLs.
- Selecting a PDF stores it in the local recent list.
- Testing a task completion shows a Windows notification if notifications are enabled.

- [ ] **Step 5: Commit README and final verification notes**

Run:

```powershell
cd C:\Users\xk\Desktop\paper-reader-desktop
git add README.md
git commit -m "docs: add desktop client setup notes"
```

---

## Self-Review

Spec coverage:

- Separate desktop project: covered by Tasks 3-6 using `C:/Users/xk/Desktop/paper-reader-desktop`.
- Shared backend: covered by Tasks 1-2 through `/api/literature/search`.
- Aggregated literature search: covered by Tasks 1, 2, and 4.
- Built-in academic-site browser: covered by Task 4 with `ACADEMIC_ENGINES` and `webview`.
- Local PDF entry: covered by Task 5.
- Medium offline foundation: covered by Task 5 local store and sync queue.
- Task notifications: covered by Task 5.
- No existing web frontend changes: no task touches `frontend/`.

Plan checks:

- No task requires modifying the existing web frontend.
- Backend changes are limited to shared API additions.
- Each implementation task has a failing test or a build/smoke check before commit.
- The first desktop local store uses JSON to avoid native database build failures in Phase 1. The store API is isolated so a SQLite implementation can replace it without changing renderer UI calls.
