import unittest

from app.services.llm import _completion_options, _structured_completion_options


class GlmCompletionOptionsTest(unittest.TestCase):
    def test_glm_flash_keeps_reasoning_enabled(self):
        self.assertEqual(
            _completion_options(
                base_url="https://open.bigmodel.cn/api/paas/v4",
                model="glm-4.7-flash",
            ),
            {"extra_body": {"thinking": {"type": "enabled"}}},
        )

    def test_other_providers_keep_default_options(self):
        self.assertEqual(
            _completion_options(
                base_url="https://api.deepseek.com",
                model="deepseek-v4-flash",
            ),
            {},
        )

    def test_structured_deepseek_requests_json_and_disables_thinking(self):
        self.assertEqual(
            _structured_completion_options(
                base_url="https://api.deepseek.com",
                model="deepseek-v4-flash",
            ),
            {
                "extra_body": {"thinking": {"type": "disabled"}},
                "response_format": {"type": "json_object"},
            },
        )


if __name__ == "__main__":
    unittest.main()
