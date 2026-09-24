import unittest
from types import SimpleNamespace

from app.services.llm import _parse_json_message, _parse_json_payload, _response_preview


class LlmJsonParsingTests(unittest.TestCase):
    def test_extracts_json_surrounded_by_explanation(self):
        payload = _parse_json_payload(
            "下面是结果：\n{\"items\":[{\"title_cn\":\"方法\"}]}\n以上。"
        )
        self.assertEqual(payload["items"][0]["title_cn"], "方法")

    def test_extracts_json_from_markdown_code_fence(self):
        payload = _parse_json_payload(
            "```json\n{\"questions\":[\"问题\"]}\n```"
        )
        self.assertEqual(payload["questions"], ["问题"])

    def test_uses_reasoning_content_when_content_is_empty(self):
        message = SimpleNamespace(
            content="",
            reasoning_content='已完成推理，最终结果：{"groups":[]}',
        )
        self.assertEqual(
            _parse_json_message(message, include_reasoning=True),
            {"groups": []},
        )

    def test_preview_is_bounded_and_combines_response_fields(self):
        message = SimpleNamespace(content="a" * 500, reasoning_content="b" * 500)
        preview = _response_preview(message, limit=80)
        self.assertEqual(len(preview), 80)
        self.assertIn("a", preview)


if __name__ == "__main__":
    unittest.main()
