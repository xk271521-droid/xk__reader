import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

import fitz
from docx import Document

from app.api.routes.paper import _build_annotated_docx
from app.models import Paper, PdfAnnotation


class PdfAnnotationWordExportTest(unittest.TestCase):
    def test_word_export_includes_canonical_embedpdf_annotations(self) -> None:
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_file:
                temp_path = Path(temp_file.name)

            with fitz.open() as source:
                page = source.new_page()
                page.insert_text((72, 72), "Source paper text")
                source.save(temp_path)

            paper = Paper(file_name="paper.pdf", file_path=str(temp_path), title="Export Test")
            annotation = PdfAnnotation(
                uid="word-export-annotation",
                user_id=1,
                paper_id=1,
                page_index=0,
                annotation_type="highlight",
                payload_json=json.dumps({"custom": {"text": "Selected PDFium evidence"}}),
                version=1,
            )

            content = _build_annotated_docx(paper, temp_path, [], [], [annotation])
            exported = Document(BytesIO(content))
            text = "\n".join(paragraph.text for paragraph in exported.paragraphs)

            self.assertIn("Page 1 - Highlight", text)
            self.assertIn("Selected PDFium evidence", text)
        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink()


if __name__ == "__main__":
    unittest.main()
