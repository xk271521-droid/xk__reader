from __future__ import annotations

import unittest
import warnings
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.exc import SAWarning

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models import User
from app.services.literature_search import LiteratureResult


class LiteratureRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        warnings.filterwarnings(
            "ignore",
            message=r"relationship 'PaperNote.*",
            category=SAWarning,
        )

        def fake_current_user() -> User:
            return User(
                id=1,
                uid="test-user",
                phone="",
                email="test@example.com",
                password_hash="x",
                status="active",
            )

        def fake_db():
            yield None

        app.dependency_overrides[get_current_user] = fake_current_user
        app.dependency_overrides[get_db] = fake_db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_search_returns_normalized_payload(self) -> None:
        result = LiteratureResult(
            source="openalex",
            source_id="W1",
            title="Desktop Search",
            authors=["Ada Lovelace"],
            year=2024,
            venue="Journal of Desktops",
            doi="10.1000/desktop",
            abstract="A useful abstract.",
            url="https://example.test/work",
            pdf_url="https://example.test/work.pdf",
            citation_count=12,
        )

        with patch(
            "app.api.routes.literature.search_literature",
            return_value=([result], ["openalex"], False),
        ) as search:
            response = self.client.get("/api/literature/search?q=desktop&limit=5")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "query": "desktop",
                "sources": ["openalex"],
                "cached": False,
                "results": [
                    {
                        "source": "openalex",
                        "source_id": "W1",
                        "title": "Desktop Search",
                        "authors": ["Ada Lovelace"],
                        "year": 2024,
                        "venue": "Journal of Desktops",
                        "doi": "10.1000/desktop",
                        "arxiv_id": "",
                        "abstract": "A useful abstract.",
                        "url": "https://example.test/work",
                        "pdf_url": "https://example.test/work.pdf",
                        "citation_count": 12,
                        "imported_paper_id": None,
                    }
                ],
            },
        )
        search.assert_called_once_with("desktop", limit=5, sources=None, db=None)

    def test_search_rejects_blank_query_after_compaction(self) -> None:
        response = self.client.get("/api/literature/search?q=%20%20")

        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
