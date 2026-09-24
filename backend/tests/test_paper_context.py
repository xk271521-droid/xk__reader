import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import fitz

from app.services import paper_context
from app.services.llm import PAPER_QA_SYSTEM_PROMPT, _build_paper_qa_message


class PaperContextTest(unittest.TestCase):
    def tearDown(self):
        paper_context._extract_pdf_text_cached.cache_clear()

    def test_extracts_every_text_page_with_page_markers(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            paper_path = root / "paper.pdf"
            document = fitz.open()
            first_page = document.new_page()
            first_page.insert_text((72, 72), "Introduction evidence")
            second_page = document.new_page()
            second_page.insert_text((72, 72), "Results evidence")
            document.save(paper_path)
            document.close()

            with patch.object(
                paper_context,
                "settings",
                SimpleNamespace(papers_upload_dir=str(root)),
            ):
                full_text = paper_context.extract_paper_full_text(
                    "/uploads/papers/paper.pdf"
                )

            self.assertIn("[第 1 页]", full_text)
            self.assertIn("Introduction evidence", full_text)
            self.assertIn("[第 2 页]", full_text)
            self.assertIn("Results evidence", full_text)

    def test_manual_question_excludes_selection_and_history(self):
        message = _build_paper_qa_message(
            paper_title="Paper A",
            full_text="[第 1 页]\nFull paper evidence",
            question="What is the conclusion?",
            selected_text="stale selection",
            request_kind="question",
        )

        self.assertIn("Full paper evidence", message)
        self.assertIn("What is the conclusion?", message)
        self.assertNotIn("stale selection", message)
        self.assertNotIn("previous message", message)

    def test_deep_read_places_selection_after_stable_full_text_prefix(self):
        message = _build_paper_qa_message(
            paper_title="Paper A",
            full_text="[第 1 页]\nFull paper evidence",
            question="selected passage",
            selected_text="selected passage",
            request_kind="deep_read",
        )

        self.assertLess(
            message.index("Full paper evidence"),
            message.index("selected passage"),
        )
        self.assertIn("AI 精读", message)

    def test_paper_qa_uses_paper_evidence_without_forbidding_general_knowledge(self):
        self.assertIn("不是你的知识边界", PAPER_QA_SYSTEM_PROMPT)
        self.assertIn("先判断问题意图", PAPER_QA_SYSTEM_PROMPT)
        self.assertIn("标准化解释和口语化解释", PAPER_QA_SYSTEM_PROMPT)
        self.assertIn("论文事实型", PAPER_QA_SYSTEM_PROMPT)
        self.assertIn("论文未明确说明", PAPER_QA_SYSTEM_PROMPT)
        self.assertNotIn("只能依据请求中提供的当前论文全文回答", PAPER_QA_SYSTEM_PROMPT)

    def test_deep_read_explains_terms_and_sentences_before_paper_context(self):
        message = _build_paper_qa_message(
            paper_title="Paper A",
            full_text="[第 1 页]\nThe paper uses attention.",
            question="What does attention mean here?",
            selected_text="attention",
            request_kind="deep_read",
        )

        self.assertIn("先给标准化学术解释", message)
        self.assertIn("再给口语化解释", message)
        self.assertIn("不要因为全文已提供就放弃模型自己的知识解释", message)


if __name__ == "__main__":
    unittest.main()
