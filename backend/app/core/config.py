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
    uploads_dir: str = os.getenv("UPLOADS_DIR", str(BASE_DIR / "uploads"))
    avatar_upload_dir: str = os.getenv("AVATAR_UPLOAD_DIR", str(BASE_DIR / "uploads" / "avatars"))
    avatar_max_size_bytes: int = int(os.getenv("AVATAR_MAX_SIZE_BYTES", str(2 * 1024 * 1024)))
    papers_upload_dir: str = os.getenv("PAPERS_UPLOAD_DIR", str(BASE_DIR / "uploads" / "papers"))
    baidu_translate_appid: str = os.getenv("BAIDU_TRANSLATE_APPID", "")
    baidu_translate_secret: str = os.getenv("BAIDU_TRANSLATE_SECRET", "")

    @property
    def translate_enabled(self) -> bool:
        return bool(self.baidu_translate_appid and self.baidu_translate_secret)

    @property
    def ai_enabled(self) -> bool:
        return bool(self.openai_api_key)


settings = Settings()
