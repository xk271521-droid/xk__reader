import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.routes.ai_provider import _resolve_provider_test_values, test_provider_connection
from app.schemas.ai_provider import AiProviderTestRequest


class AiProviderConnectionTests(unittest.TestCase):
    def test_transient_values_are_used_without_a_saved_provider(self):
        values = _resolve_provider_test_values(
            AiProviderTestRequest(
                base_url="https://api.deepseek.com/",
                api_key="test-key",
                model="deepseek-chat",
            ),
            SimpleNamespace(id=1),
            MagicMock(),
        )
        self.assertEqual(values, ("https://api.deepseek.com", "test-key", "deepseek-chat"))

    @patch("app.api.routes.ai_provider.OpenAI")
    def test_connection_uses_one_short_chat_request(self, openai_class):
        client = openai_class.return_value
        client.chat.completions.create.return_value = MagicMock()
        result = test_provider_connection(
            AiProviderTestRequest(
                base_url="https://api.deepseek.com",
                api_key="test-key",
                model="deepseek-chat",
            ),
            SimpleNamespace(id=1),
            MagicMock(),
        )
        self.assertTrue(result.success)
        client.chat.completions.create.assert_called_once()
        self.assertEqual(client.chat.completions.create.call_args.kwargs["max_tokens"], 1)


if __name__ == "__main__":
    unittest.main()
