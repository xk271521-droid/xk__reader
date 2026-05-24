from __future__ import annotations

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
    def test_normalize_doi_strips_url_and_lowercases(self) -> None:
        self.assertEqual(
            normalize_doi(" DOI: https://doi.org/10.1234/ABC.Def "),
            "10.1234/abc.def",
        )
        self.assertEqual(
            normalize_doi("https://dx.doi.org/10.5555/Test"),
            "10.5555/test",
        )

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


if __name__ == "__main__":
    unittest.main()
