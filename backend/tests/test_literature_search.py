from __future__ import annotations

import unittest
from unittest.mock import patch

from pydantic import ValidationError

from app.schemas.literature import LiteratureSearchRequest, LiteratureSearchResponse
from app.services.literature_search import (
    DEFAULT_SOURCES,
    LiteratureResult,
    cache_key,
    compact_text,
    dedupe_literature_results,
    normalize_arxiv_entry,
    normalize_arxiv_id,
    normalize_crossref_work,
    normalize_doi,
    normalize_openalex_work,
    normalize_sources,
    normalize_semantic_scholar_paper,
    search_literature,
    _store_cached_results,
)


class LiteratureSearchNormalizationTest(unittest.TestCase):
    def test_compact_text_unescapes_html_strips_tags_and_collapses_whitespace(self) -> None:
        self.assertEqual(
            compact_text("  A&nbsp;<jats:p>nested <b>value</b></jats:p>\n\nwith\tspace  "),
            "A nested value with space",
        )
        self.assertEqual(compact_text(None), "")

    def test_normalize_doi_strips_url_and_lowercases(self) -> None:
        self.assertEqual(
            normalize_doi(" DOI: https://doi.org/10.1234/ABC.Def "),
            "10.1234/abc.def",
        )
        self.assertEqual(
            normalize_doi("https://dx.doi.org/10.5555/Test"),
            "10.5555/test",
        )

    def test_normalize_arxiv_id_strips_urls_pdf_suffix_and_version(self) -> None:
        self.assertEqual(
            normalize_arxiv_id("https://arxiv.org/abs/2401.12345v3"),
            "2401.12345",
        )
        self.assertEqual(
            normalize_arxiv_id("https://arxiv.org/pdf/2401.12345v2.pdf"),
            "2401.12345",
        )
        self.assertEqual(normalize_arxiv_id("arXiv:hep-th/9901001v1"), "hep-th/9901001")

    def test_normalize_openalex_work_reconstructs_abstract(self) -> None:
        result = normalize_openalex_work(
            {
                "id": "https://openalex.org/W123",
                "display_name": "Open Work",
                "publication_year": 2024,
                "doi": "https://doi.org/10.1000/OPEN",
                "cited_by_count": 42,
                "authorships": [
                    {"author": {"display_name": "Ada Lovelace"}},
                    {"author": {"display_name": "Grace Hopper"}},
                ],
                "primary_location": {
                    "landing_page_url": "https://example.test/work",
                    "pdf_url": "https://example.test/work.pdf",
                    "source": {"display_name": "Journal of Tests"},
                },
                "abstract_inverted_index": {
                    "indexed": [1],
                    "Abstract": [0],
                    "correctly.": [2],
                },
            }
        )

        self.assertEqual(result.source, "openalex")
        self.assertEqual(result.source_id, "W123")
        self.assertEqual(result.title, "Open Work")
        self.assertEqual(result.authors, ["Ada Lovelace", "Grace Hopper"])
        self.assertEqual(result.year, 2024)
        self.assertEqual(result.venue, "Journal of Tests")
        self.assertEqual(result.doi, "10.1000/open")
        self.assertEqual(result.url, "https://example.test/work")
        self.assertEqual(result.pdf_url, "https://example.test/work.pdf")
        self.assertEqual(result.citation_count, 42)
        self.assertEqual(result.abstract, "Abstract indexed correctly.")

    def test_normalize_crossref_work_handles_authors_and_jats_abstract(self) -> None:
        result = normalize_crossref_work(
            {
                "DOI": "10.2000/CROSS",
                "title": ["Crossref Work"],
                "container-title": ["Conference on Tests"],
                "author": [
                    {"given": "Katherine", "family": "Johnson"},
                    {"name": "Research Group"},
                ],
                "published-online": {"date-parts": [[2023, 5, 1]]},
                "URL": "https://crossref.test/work",
                "abstract": "<jats:p> A <b>clean</b> abstract. </jats:p>",
            }
        )

        self.assertEqual(result.source, "crossref")
        self.assertEqual(result.source_id, "10.2000/cross")
        self.assertEqual(result.title, "Crossref Work")
        self.assertEqual(result.venue, "Conference on Tests")
        self.assertEqual(result.authors, ["Katherine Johnson", "Research Group"])
        self.assertEqual(result.year, 2023)
        self.assertEqual(result.url, "https://crossref.test/work")
        self.assertEqual(result.abstract, "A clean abstract.")

    def test_normalize_arxiv_entry_extracts_id_year_and_pdf_url(self) -> None:
        result = normalize_arxiv_entry(
            {
                "id": "https://arxiv.org/abs/2401.12345v2",
                "title": " Arxiv Work\n ",
                "summary": " Summary\n text ",
                "published": "2024-01-02T00:00:00Z",
                "authors": [{"name": "Alan Turing"}, "Alonzo Church"],
                "links": [
                    {"href": "https://arxiv.org/abs/2401.12345v2", "type": "text/html"},
                    {
                        "href": "https://arxiv.org/pdf/2401.12345v2.pdf",
                        "type": "application/pdf",
                    },
                ],
            }
        )

        self.assertEqual(result.source, "arxiv")
        self.assertEqual(result.source_id, "2401.12345")
        self.assertEqual(result.arxiv_id, "2401.12345")
        self.assertEqual(result.year, 2024)
        self.assertEqual(result.title, "Arxiv Work")
        self.assertEqual(result.authors, ["Alan Turing", "Alonzo Church"])
        self.assertEqual(result.url, "https://arxiv.org/abs/2401.12345v2")
        self.assertEqual(result.pdf_url, "https://arxiv.org/pdf/2401.12345v2.pdf")

    def test_normalize_semantic_scholar_paper_maps_external_ids_and_pdf(self) -> None:
        result = normalize_semantic_scholar_paper(
            {
                "paperId": "abc123",
                "title": "Semantic Work",
                "abstract": "An abstract",
                "year": 2022,
                "citationCount": 17,
                "venue": "Semantic Venue",
                "authors": [{"name": "Barbara Liskov"}],
                "externalIds": {"DOI": "10.3000/SEM", "ArXiv": "2201.99999v1"},
                "openAccessPdf": {"url": "https://pdf.test/sem.pdf"},
                "url": "https://semanticscholar.org/paper/abc123",
            }
        )

        self.assertEqual(result.source, "semantic_scholar")
        self.assertEqual(result.source_id, "abc123")
        self.assertEqual(result.doi, "10.3000/sem")
        self.assertEqual(result.arxiv_id, "2201.99999")
        self.assertEqual(result.pdf_url, "https://pdf.test/sem.pdf")
        self.assertEqual(result.citation_count, 17)
        self.assertEqual(result.authors, ["Barbara Liskov"])

    def test_normalize_sources_filters_invalid_sources_and_defaults(self) -> None:
        self.assertEqual(
            normalize_sources(["CrossRef", "unknown", "arxiv", "crossref", " "]),
            ["crossref", "arxiv"],
        )
        self.assertEqual(normalize_sources([]), DEFAULT_SOURCES)
        self.assertIsNot(normalize_sources([]), DEFAULT_SOURCES)

    def test_cache_key_uses_compact_query_sorted_sources_and_limit(self) -> None:
        self.assertEqual(
            cache_key(" Graph\n Mining ", ["semantic_scholar", "openalex"], 5),
            '{"limit":5,"q":"graph mining","sources":["openalex","semantic_scholar"]}',
        )

    def test_literature_result_to_schema_preserves_fields(self) -> None:
        result = LiteratureResult(
            source="openalex",
            source_id="W1",
            title="Schema Work",
            authors=["Author One"],
            year=2020,
            venue="Venue",
            doi="10.5000/schema",
            arxiv_id="2001.00001",
            abstract="Abstract",
            url="https://example.test/work",
            pdf_url="https://example.test/work.pdf",
            citation_count=10,
            imported_paper_id=7,
        )

        schema = result.to_schema()

        self.assertEqual(schema.source, "openalex")
        self.assertEqual(schema.source_id, "W1")
        self.assertEqual(schema.title, "Schema Work")
        self.assertEqual(schema.authors, ["Author One"])
        self.assertEqual(schema.year, 2020)
        self.assertEqual(schema.venue, "Venue")
        self.assertEqual(schema.doi, "10.5000/schema")
        self.assertEqual(schema.arxiv_id, "2001.00001")
        self.assertEqual(schema.abstract, "Abstract")
        self.assertEqual(schema.url, "https://example.test/work")
        self.assertEqual(schema.pdf_url, "https://example.test/work.pdf")
        self.assertEqual(schema.citation_count, 10)
        self.assertEqual(schema.imported_paper_id, 7)

    def test_literature_schemas_apply_defaults_and_validation(self) -> None:
        request = LiteratureSearchRequest(query="paper")
        response = LiteratureSearchResponse(query="paper", results=[], sources=["openalex"])

        self.assertEqual(request.limit, 20)
        self.assertEqual(request.sources, [])
        self.assertFalse(response.cached)

        with self.assertRaises(ValidationError):
            LiteratureSearchRequest(query="")
        with self.assertRaises(ValidationError):
            LiteratureSearchRequest(query="x" * 301)
        with self.assertRaises(ValidationError):
            LiteratureSearchRequest(query="paper", limit=0)
        with self.assertRaises(ValidationError):
            LiteratureSearchRequest(query="paper", limit=51)

    def test_dedupe_literature_results_keeps_stronger_result(self) -> None:
        weak = LiteratureResult(
            source="crossref",
            source_id="weak",
            title="Same Work",
            year=2021,
            doi="10.4000/same",
            citation_count=2,
        )
        strong = LiteratureResult(
            source="openalex",
            source_id="strong",
            title="Same Work",
            authors=["Author One"],
            year=2021,
            doi="10.4000/same",
            abstract="Detailed abstract",
            pdf_url="https://example.test/same.pdf",
            citation_count=99,
        )

        results = dedupe_literature_results(
            [
                weak,
                LiteratureResult(source="arxiv", source_id="empty", title=" "),
                strong,
            ]
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].source_id, "strong")
        self.assertEqual(results[0].pdf_url, "https://example.test/same.pdf")
        self.assertEqual(results[0].citation_count, 99)

    def test_dedupe_literature_results_matches_by_arxiv_id(self) -> None:
        weak = LiteratureResult(
            source="semantic_scholar",
            source_id="weak-arxiv",
            title="Arxiv Duplicate",
            arxiv_id="2401.12345v1",
            citation_count=4,
        )
        strong = LiteratureResult(
            source="arxiv",
            source_id="strong-arxiv",
            title="Arxiv Duplicate Revised",
            arxiv_id="https://arxiv.org/abs/2401.12345v2",
            pdf_url="https://arxiv.org/pdf/2401.12345v2.pdf",
            citation_count=3,
        )

        results = dedupe_literature_results([weak, strong])

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].source_id, "strong-arxiv")

    def test_dedupe_literature_results_matches_by_title_year_fallback(self) -> None:
        weak = LiteratureResult(
            source="crossref",
            source_id="weak-title",
            title="Same: Title!",
            year=2019,
            citation_count=2,
        )
        strong = LiteratureResult(
            source="openalex",
            source_id="strong-title",
            title="same title",
            authors=["Author One", "Author Two"],
            year=2019,
            abstract="Abstract",
            citation_count=2,
        )

        results = dedupe_literature_results([weak, strong])

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].source_id, "strong-title")

    def test_dedupe_literature_results_sorts_by_citation_count_descending(self) -> None:
        results = dedupe_literature_results(
            [
                LiteratureResult(
                    source="crossref",
                    source_id="middle",
                    title="Middle Cited",
                    citation_count=5,
                ),
                LiteratureResult(
                    source="openalex",
                    source_id="uncited",
                    title="Uncited",
                    citation_count=None,
                ),
                LiteratureResult(
                    source="semantic_scholar",
                    source_id="top",
                    title="Top Cited",
                    citation_count=50,
                ),
            ]
        )

        self.assertEqual([result.source_id for result in results], ["top", "middle", "uncited"])

    def test_search_literature_ignores_failed_source_without_cache_db(self) -> None:
        def raise_fetcher(query: str, limit: int) -> list[LiteratureResult]:
            raise RuntimeError("source unavailable")

        def good_fetcher(query: str, limit: int) -> list[LiteratureResult]:
            return [
                LiteratureResult(
                    source="crossref",
                    source_id="10.1000/desktop",
                    title="Desktop Search",
                    doi="10.1000/desktop",
                    citation_count=5,
                )
            ]

        with patch(
            "app.services.literature_search.SOURCE_FETCHERS",
            {"openalex": raise_fetcher, "crossref": good_fetcher},
        ):
            results, selected_sources, cached = search_literature(
                "desktop",
                limit=5,
                sources=["openalex", "crossref"],
                db=None,
            )

        self.assertFalse(cached)
        self.assertEqual(selected_sources, ["openalex", "crossref"])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].source, "crossref")
        self.assertEqual(results[0].title, "Desktop Search")

    def test_paper_literature_cache_imports_from_models(self) -> None:
        from app.models import PaperLiteratureCache

        self.assertEqual(PaperLiteratureCache.__tablename__, "paper_literature_caches")

    def test_store_cached_results_rolls_back_when_commit_fails(self) -> None:
        class FailingCommitDb:
            def __init__(self) -> None:
                self.added = []
                self.rolled_back = False

            def scalar(self, statement: object) -> None:
                return None

            def add(self, cache: object) -> None:
                self.added.append(cache)

            def commit(self) -> None:
                raise RuntimeError("commit failed")

            def rollback(self) -> None:
                self.rolled_back = True

        db = FailingCommitDb()

        _store_cached_results(
            db,
            "cache-key",
            [LiteratureResult(source="crossref", source_id="10.1/test", title="Cached Work")],
            ["crossref"],
        )

        self.assertEqual(len(db.added), 1)
        self.assertTrue(db.rolled_back)

    def test_search_literature_returns_cached_results_from_db(self) -> None:
        class CacheDb:
            def scalar(self, statement: object) -> object:
                return type(
                    "CachedLiterature",
                    (),
                    {
                        "payload_json": [
                            {
                                "source": "openalex",
                                "source_id": "W1",
                                "title": "Cached Work",
                            }
                        ]
                    },
                )()

        results, selected_sources, cached = search_literature(
            "cached work",
            limit=5,
            sources=["openalex"],
            db=CacheDb(),
        )

        self.assertTrue(cached)
        self.assertEqual(selected_sources, ["openalex"])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].title, "Cached Work")


if __name__ == "__main__":
    unittest.main()
