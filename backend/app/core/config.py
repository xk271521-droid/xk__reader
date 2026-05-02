from __future__ import annotations

import os
from pathlib import Path
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def _split_csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


BASE_DIR = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    app_name: str = "Paper Reader MVP API"
    allowed_origins: tuple[str, ...] = field(
        default_factory=lambda: _split_csv(
            os.getenv(
                "ALLOWED_ORIGINS",
                ",".join(
                    (
                        "http://127.0.0.1:5173",
                        "http://localhost:5173",
                        "http://127.0.0.1:5174",
                        "http://localhost:5174",
                        "http://127.0.0.1:5177",
                        "http://localhost:5177",
                        "http://127.0.0.1:5178",
                        "http://localhost:5178",
                        "http://127.0.0.1:5181",
                        "http://localhost:5181",
                        "http://127.0.0.1:5185",
                        "http://localhost:5185",
                    )
                ),
            )
        )
    )
    database_url: str = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://root:123456@127.0.0.1:3306/xk_reader?charset=utf8mb4",
    )
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "change-me-before-production")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    access_token_expire_minutes: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080")
    )
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    secret_key: str = os.getenv("SECRET_KEY", "change-me-before-production")
    uploads_dir: str = os.getenv("UPLOADS_DIR", str(BASE_DIR / "uploads"))
    avatar_upload_dir: str = os.getenv("AVATAR_UPLOAD_DIR", str(BASE_DIR / "uploads" / "avatars"))
    avatar_max_size_bytes: int = int(os.getenv("AVATAR_MAX_SIZE_BYTES", str(2 * 1024 * 1024)))
    papers_upload_dir: str = os.getenv("PAPERS_UPLOAD_DIR", str(BASE_DIR / "uploads" / "papers"))
    baidu_translate_appid: str = os.getenv("BAIDU_TRANSLATE_APPID", "")
    baidu_translate_secret: str = os.getenv("BAIDU_TRANSLATE_SECRET", "")

    # 系统默认 AI 提供者（所有用户共享）
    default_glm_api_key: str = os.getenv("DEFAULT_GLM_API_KEY", "")
    default_deepseek_api_key: str = os.getenv("DEFAULT_DEEPSEEK_API_KEY", "")

    @property
    def translate_enabled(self) -> bool:
        return bool(self.baidu_translate_appid and self.baidu_translate_secret)

    @property
    def ai_enabled(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def system_providers(self) -> list[dict[str, str]]:
        """启动时自动创建的系统默认厂商列表"""
        providers = []
        if self.default_glm_api_key:
            providers.append({
                "label": "智谱 GLM-4-Flash (官方)",
                "base_url": "https://open.bigmodel.cn/api/paas/v4",
                "api_key": self.default_glm_api_key,
                "model": "glm-4-flash",
                "sort_order": 0,
            })
        if self.default_deepseek_api_key:
            providers.append({
                "label": "DeepSeek V3 (官方)",
                "base_url": "https://api.deepseek.com",
                "api_key": self.default_deepseek_api_key,
                "model": "deepseek-chat",
                "sort_order": 1,
            })
        return providers


settings = Settings()
