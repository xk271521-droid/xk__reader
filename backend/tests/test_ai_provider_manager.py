import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services.ai_provider_manager import (
    find_builtin_provider_for_blueprint,
    resolve_user_provider,
    resolve_siliconflow_provider,
)


FLASH_BLUEPRINT = {
    "label": "DeepSeek V4 Flash (官方)",
    "base_url": "https://api.deepseek.com",
    "api_key": "test-key",
    "model": "deepseek-v4-flash",
    "sort_order": 1,
}

GLM_FLASH_BLUEPRINT = {
    "label": "智谱 GLM-4.7 Flash (官方)",
    "base_url": "https://open.bigmodel.cn/api/paas/v4",
    "api_key": "test-key",
    "model": "glm-4.7-flash",
    "sort_order": 0,
}


class AiProviderManagerTest(unittest.TestCase):
    def test_matches_legacy_official_glm_card_for_in_place_upgrade(self):
        legacy = SimpleNamespace(
            user_id=12,
            label="智谱 GLM-4-Flash (官方)",
            base_url="https://open.bigmodel.cn/api/paas/v4",
            model="glm-4-flash",
        )

        self.assertIs(
            find_builtin_provider_for_blueprint([legacy], GLM_FLASH_BLUEPRINT),
            legacy,
        )

    def test_does_not_rewrite_custom_glm_provider_on_same_endpoint(self):
        custom = SimpleNamespace(
            user_id=12,
            label="我的智谱模型",
            base_url="https://open.bigmodel.cn/api/paas/v4",
            model="glm-4-flash",
        )

        self.assertIsNone(
            find_builtin_provider_for_blueprint([custom], GLM_FLASH_BLUEPRINT)
        )

    def test_matches_legacy_official_deepseek_card_for_in_place_upgrade(self):
        legacy = SimpleNamespace(
            user_id=12,
            label="DeepSeek V3 (官方)",
            base_url="https://api.deepseek.com",
            model="deepseek-chat",
        )

        self.assertIs(
            find_builtin_provider_for_blueprint([legacy], FLASH_BLUEPRINT),
            legacy,
        )

    def test_does_not_rewrite_custom_provider_on_same_endpoint(self):
        custom = SimpleNamespace(
            user_id=12,
            label="我的 DeepSeek",
            base_url="https://api.deepseek.com",
            model="deepseek-chat",
        )

        self.assertIsNone(
            find_builtin_provider_for_blueprint([custom], FLASH_BLUEPRINT)
        )

    def test_matches_current_flash_card(self):
        current = SimpleNamespace(
            user_id=12,
            label="DeepSeek V4 Flash (官方)",
            base_url="https://api.deepseek.com",
            model="deepseek-v4-flash",
        )

        self.assertIs(
            find_builtin_provider_for_blueprint([current], FLASH_BLUEPRINT),
            current,
        )

    def test_translation_provider_can_be_inactive_while_chat_uses_another_provider(self):
        deepseek = SimpleNamespace(
            id=1,
            user_id=12,
            label="DeepSeek",
            base_url="https://api.deepseek.com",
            model="deepseek-chat",
            is_active=True,
        )
        siliconflow = SimpleNamespace(
            id=2,
            user_id=12,
            label="SiliconFlow 翻译",
            base_url="https://api.siliconflow.cn/v1",
            model="THUDM/GLM-4-9B-0414",
            is_active=False,
        )
        with patch(
            "app.services.ai_provider_manager.list_user_providers",
            return_value=[deepseek, siliconflow],
        ):
            selected = resolve_siliconflow_provider(SimpleNamespace(), 12)

        self.assertIs(selected, siliconflow)

    def test_siliconflow_provider_id_is_not_accepted_by_global_chat_resolution(self):
        siliconflow = SimpleNamespace(
            id=2,
            user_id=12,
            label="SiliconFlow 翻译",
            base_url="https://api.siliconflow.cn/v1",
            model="THUDM/GLM-4-9B-0414",
            is_active=True,
        )
        class _Db:
            def __init__(self):
                self.statements = []

            def scalar(self, statement):
                self.statements.append(statement)
                return None

        db = _Db()
        with patch(
            "app.services.ai_provider_manager.ensure_user_default_providers",
            return_value=[siliconflow],
        ):
            # The important contract is that the global resolver adds a
            # SiliconFlow exclusion even when a caller supplies its id.
            resolve_user_provider(db, 12, provider_id=2)

        self.assertTrue(
            any(
                "siliconflow" in str(
                    statement.compile(compile_kwargs={"literal_binds": True})
                ).lower()
                for statement in db.statements
            )
        )


if __name__ == "__main__":
    unittest.main()
