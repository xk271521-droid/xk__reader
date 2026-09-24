from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.services import pdfmathtranslate


class PdfMathTranslateRunnerTests(unittest.TestCase):
    def _settings(self, root: Path) -> SimpleNamespace:
        return SimpleNamespace(
            papers_upload_dir=str(root / "papers"),
            full_translation_output_dir=str(root / "translations"),
            pdfmathtranslate_command="pdf2zh",
            pdfmathtranslate_args="-li {source_lang} -lo {target_lang} -s {service} -o {output_dir} {input_pdf}",
            pdfmathtranslate_source_lang="en",
            pdfmathtranslate_target_lang="zh",
            pdfmathtranslate_thread=1,
            pdfmathtranslate_timeout_seconds=120,
            pdfmathtranslate_output_glob="*.pdf",
        )

    def _provider(self) -> pdfmathtranslate.PdfMathTranslateProvider:
        return pdfmathtranslate.PdfMathTranslateProvider(
            provider_id=7,
            label="GLM Flash",
            base_url="https://open.bigmodel.cn/api/paas/v4",
            api_key="test-glm-key",
            model="glm-4.7-flash",
        )

    def test_runner_keeps_spaced_paths_as_single_process_arguments(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source paper.pdf"
            source.write_bytes(b"%PDF-1.7\nexample source\n")
            captured: dict[str, list[str]] = {}

            def fake_run(command, **kwargs):
                captured["command"] = command
                self.assertEqual(kwargs["environment"]["ZHIPU_API_KEY"], "test-glm-key")
                self.assertEqual(kwargs["environment"]["ZHIPU_MODEL"], "glm-4.7-flash")
                output_dir = Path(command[command.index("-o") + 1])
                (output_dir / "source-mono.pdf").write_bytes(b"%PDF-1.7\ntranslated output\n")
                return SimpleNamespace(returncode=0, stdout="done", stderr="")

            with (
                patch.object(pdfmathtranslate, "settings", self._settings(root)),
                patch.object(pdfmathtranslate, "_execute_pdfmathtranslate_command", side_effect=fake_run),
            ):
                result = pdfmathtranslate.run_pdfmathtranslate(
                    source,
                    job_dir=root / "job folder",
                    provider=self._provider(),
                )

            self.assertEqual(captured["command"][0], "pdf2zh")
            self.assertEqual(captured["command"][-1], str(root / "job folder" / "source.pdf"))
            self.assertEqual(result.output_pdf.name, "source-mono.pdf")
            self.assertEqual(result.summary["renderer"], "babeldoc")

    def test_artifact_destination_rejects_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.object(pdfmathtranslate, "settings", self._settings(Path(temporary_directory))):
                with self.assertRaises(pdfmathtranslate.PdfMathTranslateError):
                    pdfmathtranslate.translation_artifact_destination("../outside.pdf")

    def test_runner_command_can_include_a_python_compatibility_entry_point(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            test_settings = self._settings(root)
            test_settings.pdfmathtranslate_command = "python runtime/pdfmathtranslate_entry.py"
            with patch.object(pdfmathtranslate, "settings", test_settings):
                command = pdfmathtranslate._format_command_args(
                    root / "input.pdf",
                    root / "output",
                    provider=self._provider(),
                )

            self.assertEqual(command[:2], ["python", "runtime/pdfmathtranslate_entry.py"])
            self.assertEqual(command[-1], str(root / "input.pdf"))
            self.assertNotIn("--no-dual", command)

    def test_runner_rejects_partial_translation_after_a_success_exit_code(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "source.pdf"
            source.write_bytes(b"%PDF-1.7\nexample source\n")

            def fake_run(command, **_kwargs):
                output_dir = Path(command[command.index("-o") + 1])
                (output_dir / "source-mono.pdf").write_bytes(b"%PDF-1.7\ntranslated output\n")
                return SimpleNamespace(returncode=0, stdout="done", stderr="")

            with (
                patch.object(pdfmathtranslate, "settings", self._settings(root)),
                patch.object(pdfmathtranslate, "_execute_pdfmathtranslate_command", side_effect=fake_run),
                patch.object(
                    pdfmathtranslate,
                    "_validate_translation_coverage",
                    side_effect=pdfmathtranslate.PdfMathTranslateError("partial translation"),
                ),
            ):
                with self.assertRaisesRegex(pdfmathtranslate.PdfMathTranslateError, "partial translation"):
                    pdfmathtranslate.run_pdfmathtranslate(
                        source,
                        job_dir=root / "job",
                        provider=self._provider(),
                    )

    def test_custom_global_provider_uses_generic_openai_compatible_adapter(self) -> None:
        provider = pdfmathtranslate.PdfMathTranslateProvider(
            provider_id=8,
            label="Custom provider",
            base_url="https://example.invalid/v1",
            api_key="test-custom-key",
            model="custom-flash",
        )
        environment = pdfmathtranslate._build_process_environment(provider)

        self.assertEqual(pdfmathtranslate.service_for_provider(provider), "openailiked")
        self.assertEqual(environment["OPENAILIKED_BASE_URL"], "https://example.invalid/v1")
        self.assertEqual(environment["OPENAILIKED_MODEL"], "custom-flash")

    def test_active_deepseek_v4_flash_provider_is_used_without_a_static_model_override(self) -> None:
        provider = pdfmathtranslate.PdfMathTranslateProvider(
            provider_id=9,
            label="DeepSeek V4 Flash",
            base_url="https://api.deepseek.com",
            api_key="test-deepseek-key",
            model="deepseek-v4-flash",
        )
        environment = pdfmathtranslate._build_process_environment(provider)

        self.assertEqual(pdfmathtranslate.service_for_provider(provider), "deepseek")
        self.assertEqual(environment["DEEPSEEK_MODEL"], "deepseek-v4-flash")
        self.assertNotIn("OPENAILIKED_MODEL", environment)
