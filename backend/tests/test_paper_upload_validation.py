from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app.api.routes.paper import _is_likely_pdf_upload, _stored_file_has_pdf_header


class PaperUploadValidationTest(unittest.TestCase):
    def test_accepts_octet_stream_pdf_filename(self) -> None:
        upload = SimpleNamespace(content_type="application/octet-stream", filename="paper.pdf")

        self.assertTrue(_is_likely_pdf_upload(upload))

    def test_rejects_octet_stream_without_pdf_filename(self) -> None:
        upload = SimpleNamespace(content_type="application/octet-stream", filename="paper.txt")

        self.assertFalse(_is_likely_pdf_upload(upload))

    def test_checks_pdf_header_after_persist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            valid_pdf = Path(tmp_dir) / "valid.pdf"
            invalid_pdf = Path(tmp_dir) / "invalid.pdf"
            valid_pdf.write_bytes(b"%PDF-1.7\n1 0 obj\n")
            invalid_pdf.write_bytes(b"not a pdf")

            self.assertTrue(_stored_file_has_pdf_header(valid_pdf))
            self.assertFalse(_stored_file_has_pdf_header(invalid_pdf))


if __name__ == "__main__":
    unittest.main()
