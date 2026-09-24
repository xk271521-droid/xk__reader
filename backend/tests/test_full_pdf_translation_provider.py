from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services import full_pdf_translation


class _FakeSession:
    def __init__(self, provider=None) -> None:
        self.added: list[object] = []
        self.commit_count = 0
        self.provider = provider

    def get(self, _model, _identifier):
        return self.provider

    def add(self, item: object) -> None:
        self.added.append(item)

    def commit(self) -> None:
        self.commit_count += 1


class FullPdfTranslationProviderTests(unittest.TestCase):
    def test_legacy_job_adopts_current_user_provider(self) -> None:
        """Queued jobs created before provider snapshots use the active user card."""
        db = _FakeSession()
        user_provider = SimpleNamespace(
            id=18,
            user_id=9,
            label="DeepSeek",
            base_url="https://api.deepseek.com",
            encrypted_api_key="encrypted-key",
            model="deepseek-chat",
        )
        paper = SimpleNamespace(user_id=9)
        item = SimpleNamespace(provider_id=None, parse_summary={})

        with (
            patch.object(
                full_pdf_translation,
                "resolve_user_provider",
                return_value=user_provider,
            ),
            patch.object(full_pdf_translation, "decrypt_api_key", return_value="real-key"),
        ):
            provider = full_pdf_translation._load_translation_provider(
                db,
                paper=paper,
                item=item,
            )

        self.assertEqual(provider.provider_id, 18)
        self.assertEqual(provider.model, "deepseek-chat")
        self.assertEqual(item.provider_id, 18)
        self.assertTrue(item.parse_summary["provider_resolved_from_legacy_job"])
        self.assertEqual(db.commit_count, 1)

    def test_legacy_job_reports_missing_user_provider_clearly(self) -> None:
        db = _FakeSession()
        paper = SimpleNamespace(user_id=9)
        item = SimpleNamespace(provider_id=None, parse_summary={})

        with patch.object(full_pdf_translation, "resolve_user_provider", return_value=None), patch.object(
            full_pdf_translation, "resolve_siliconflow_provider", return_value=None
        ):
            with self.assertRaisesRegex(
                full_pdf_translation.PdfMathTranslateError,
                "AI 厂商",
            ):
                full_pdf_translation._load_translation_provider(
                    db,
                    paper=paper,
                    item=item,
                )

    def test_configured_provider_keeps_its_model(self) -> None:
        provider = SimpleNamespace(
            id=18,
            user_id=9,
            label="DeepSeek",
            base_url="https://api.deepseek.com",
            encrypted_api_key="encrypted-key",
            model="deepseek-chat",
        )
        db = _FakeSession(provider)
        paper = SimpleNamespace(user_id=9)
        item = SimpleNamespace(provider_id=18, parse_summary={})

        with patch.object(full_pdf_translation, "decrypt_api_key", return_value="real-key"):
            providers = full_pdf_translation._load_translation_providers(
                db,
                paper=paper,
                item=item,
            )

        self.assertEqual(
            [candidate.model for candidate in providers],
            ["deepseek-chat"],
        )


if __name__ == "__main__":
    unittest.main()
