import unittest
from unittest.mock import MagicMock, patch
from app.services.selection_insight import (
    TranslationProviderUnavailable,
    build_translation_result,
)
from app.models.user_translation_config import UserTranslationConfig

class SelectionTranslationConfigTest(unittest.TestCase):
    def test_baidu_unconfigured_raises_helpful_error(self):
        with self.assertRaises(TranslationProviderUnavailable) as cm:
            build_translation_result("apple", "word", translation_provider="baidu", baidu_appid="", baidu_secret="")
        self.assertIn("未配置百度翻译", str(cm.exception))

    def test_translation_config_requires_both_user_values(self):
        config = UserTranslationConfig(user_id=1, app_id="app-id", encrypted_secret_key="")
        self.assertFalse(config.is_configured)
        config.encrypted_secret_key = "ciphertext"
        self.assertTrue(config.is_configured)

if __name__ == "__main__":
    unittest.main()
