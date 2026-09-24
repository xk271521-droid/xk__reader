import unittest
from unittest.mock import patch

from app.services.selection_insight import (
    TranslationProviderUnavailable,
    build_translation_result,
)


class SelectionTranslationProviderTests(unittest.TestCase):
    def test_baidu_selection_uses_baidu_only(self) -> None:
        with patch("app.services.selection_insight.translate_text", return_value="预测") as baidu, patch(
            "app.services.selection_insight.translate_with_tencent_mt"
        ) as tencent:
            translation, source = build_translation_result(
                "prediction",
                "word",
                translation_provider="baidu",
                baidu_appid="test_appid",
                baidu_secret="test_secret",
            )

        self.assertEqual(translation, "预测")
        self.assertEqual(source, "百度通用翻译")
        baidu.assert_called_once()
        tencent.assert_not_called()

    def test_tencent_selection_uses_tencent_only(self) -> None:
        with patch("app.services.selection_insight.translate_text") as baidu, patch(
            "app.services.selection_insight.load_termbase", return_value=([], None)
        ), patch(
            "app.services.selection_insight.translate_with_tencent_mt",
            return_value={"selection": "预测"},
        ) as tencent:
            translation, source = build_translation_result(
                "prediction",
                "word",
                translation_provider="tencent",
            )

        self.assertEqual(translation, "预测")
        self.assertEqual(source, "腾讯机器翻译")
        baidu.assert_not_called()
        tencent.assert_called_once()

    def test_selected_provider_does_not_silently_fallback_to_another_provider(self) -> None:
        with patch("app.services.selection_insight.translate_text", return_value=None), patch(
            "app.services.selection_insight.translate_with_tencent_mt"
        ) as tencent:
            with self.assertRaisesRegex(TranslationProviderUnavailable, "百度翻译"):
                build_translation_result("prediction", "word", translation_provider="baidu")

        tencent.assert_not_called()

    def test_siliconflow_selection_uses_only_the_selected_model(self) -> None:
        with patch(
            "app.services.selection_insight.translate_text_with_openai",
            return_value="预测",
        ) as siliconflow:
            translation, source = build_translation_result(
                "prediction",
                "word",
                translation_provider="siliconflow_glm4",
                provider_base_url="https://api.siliconflow.cn/v1",
                provider_api_key="test-key",
            )

        self.assertEqual(translation, "预测")
        self.assertEqual(source, "SiliconFlow · GLM-4-9B-0414")
        siliconflow.assert_called_once()
        self.assertEqual(
            siliconflow.call_args.kwargs["model"],
            "THUDM/GLM-4-9B-0414",
        )


if __name__ == "__main__":
    unittest.main()
