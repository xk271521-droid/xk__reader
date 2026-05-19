from __future__ import annotations

import os
from pathlib import Path
from dataclasses import dataclass, field
from urllib.parse import quote_plus

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env", encoding="utf-8-sig")


def _split_csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _env_flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _build_database_url() -> str:
    explicit_url = os.getenv("DATABASE_URL", "").strip()
    if explicit_url:
        return explicit_url

    driver = os.getenv("DB_DRIVER", "mysql+pymysql").strip() or "mysql+pymysql"
    user = quote_plus(os.getenv("DB_USER", "root"))
    password = quote_plus(os.getenv("DB_PASSWORD", "123456"))
    host = os.getenv("DB_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = os.getenv("DB_PORT", "3306").strip() or "3306"
    name = os.getenv("DB_NAME", "xk_reader").strip() or "xk_reader"
    charset = os.getenv("DB_CHARSET", "utf8mb4").strip() or "utf8mb4"
    return f"{driver}://{user}:{password}@{host}:{port}/{name}?charset={charset}"


BASE_DIR = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    app_name: str = "Paper Reader MVP API"
    app_env: str = os.getenv("APP_ENV", "development").strip().lower() or "development"
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
    database_url: str = _build_database_url()
    database_pool_recycle_seconds: int = int(
        os.getenv("DATABASE_POOL_RECYCLE_SECONDS", "1800")
    )
    database_pool_timeout_seconds: int = int(
        os.getenv("DATABASE_POOL_TIMEOUT_SECONDS", "30")
    )
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "change-me-before-production")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    access_token_expire_minutes: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080")
    )
    auth_captcha_length: int = int(os.getenv("AUTH_CAPTCHA_LENGTH", "4"))
    auth_captcha_ttl_seconds: int = int(os.getenv("AUTH_CAPTCHA_TTL_SECONDS", "300"))
    auth_rate_limit_window_seconds: int = int(os.getenv("AUTH_RATE_LIMIT_WINDOW_SECONDS", "900"))
    auth_rate_limit_block_seconds: int = int(os.getenv("AUTH_RATE_LIMIT_BLOCK_SECONDS", "900"))
    auth_login_max_attempts_per_ip: int = int(os.getenv("AUTH_LOGIN_MAX_ATTEMPTS_PER_IP", "12"))
    auth_login_max_attempts_per_account: int = int(os.getenv("AUTH_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT", "6"))
    auth_register_max_attempts_per_ip: int = int(os.getenv("AUTH_REGISTER_MAX_ATTEMPTS_PER_IP", "8"))
    auth_register_max_attempts_per_account: int = int(os.getenv("AUTH_REGISTER_MAX_ATTEMPTS_PER_ACCOUNT", "3"))
    verification_code_ttl_seconds: int = int(os.getenv("VERIFICATION_CODE_TTL_SECONDS", "300"))
    verification_code_resend_cooldown_seconds: int = int(os.getenv("VERIFICATION_CODE_RESEND_COOLDOWN_SECONDS", "60"))
    verification_code_max_attempts: int = int(os.getenv("VERIFICATION_CODE_MAX_ATTEMPTS", "5"))
    register_verification_max_attempts_per_ip: int = int(os.getenv("REGISTER_VERIFICATION_MAX_ATTEMPTS_PER_IP", "10"))
    register_verification_max_attempts_per_target: int = int(os.getenv("REGISTER_VERIFICATION_MAX_ATTEMPTS_PER_TARGET", "5"))
    sms_code_template: str = os.getenv("SMS_CODE_TEMPLATE", "您的注册验证码为 {code}，5 分钟内有效。")
    sms_provider_order: tuple[str, ...] = field(
        default_factory=lambda: _split_csv(os.getenv("SMS_PROVIDER_ORDER", "huyi,spug,aliyun,tencent"))
    )
    email_provider_order: tuple[str, ...] = field(
        default_factory=lambda: _split_csv(os.getenv("EMAIL_PROVIDER_ORDER", "spug,smtp"))
    )
    smtp_host: str = os.getenv("SMTP_HOST", "")
    smtp_port: int = int(os.getenv("SMTP_PORT", "465"))
    smtp_username: str = os.getenv("SMTP_USERNAME", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    smtp_from_email: str = os.getenv("SMTP_FROM_EMAIL", "")
    smtp_from_name: str = os.getenv("SMTP_FROM_NAME", "XK 阅读")
    smtp_use_ssl: bool = os.getenv("SMTP_USE_SSL", "true").lower() in {"1", "true", "yes", "on"}
    spug_push_app_name: str = os.getenv("SPUG_PUSH_APP_NAME", "XK 阅读")
    spug_sms_template_url: str = os.getenv("SPUG_SMS_TEMPLATE_URL", "")
    spug_email_template_url: str = os.getenv("SPUG_EMAIL_TEMPLATE_URL", "")
    spug_request_timeout_seconds: int = int(os.getenv("SPUG_REQUEST_TIMEOUT_SECONDS", "10"))
    huyi_sms_enabled: bool = os.getenv("HUYI_SMS_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    huyi_sms_api_id: str = os.getenv("HUYI_SMS_API_ID", "")
    huyi_sms_api_key: str = os.getenv("HUYI_SMS_API_KEY", "")
    huyi_sms_template_id: str = os.getenv("HUYI_SMS_TEMPLATE_ID", "1")
    huyi_sms_endpoint: str = os.getenv("HUYI_SMS_ENDPOINT", "https://106.ihuyi.com/webservice/sms.php?method=Submit")
    aliyun_sms_enabled: bool = os.getenv("ALIYUN_SMS_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    aliyun_sms_access_key_id: str = os.getenv("ALIYUN_SMS_ACCESS_KEY_ID", "")
    aliyun_sms_access_key_secret: str = os.getenv("ALIYUN_SMS_ACCESS_KEY_SECRET", "")
    aliyun_sms_sign_name: str = os.getenv("ALIYUN_SMS_SIGN_NAME", "")
    aliyun_sms_template_code: str = os.getenv("ALIYUN_SMS_TEMPLATE_CODE", "")
    aliyun_sms_endpoint: str = os.getenv("ALIYUN_SMS_ENDPOINT", "dysmsapi.aliyuncs.com")
    tencent_sms_enabled: bool = os.getenv("TENCENT_SMS_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    tencent_sms_sdk_app_id: str = os.getenv("TENCENT_SMS_SDK_APP_ID", "")
    tencent_sms_sign_name: str = os.getenv("TENCENT_SMS_SIGN_NAME", "")
    tencent_sms_template_id: str = os.getenv("TENCENT_SMS_TEMPLATE_ID", "")
    tencent_sms_region: str = os.getenv("TENCENT_SMS_REGION", "ap-guangzhou")
    tencent_sms_endpoint: str = os.getenv("TENCENT_SMS_ENDPOINT", "sms.tencentcloudapi.com")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    secret_key: str = os.getenv("SECRET_KEY", "change-me-before-production")
    uploads_dir: str = os.getenv("UPLOADS_DIR", str(BASE_DIR / "uploads"))
    avatar_upload_dir: str = os.getenv("AVATAR_UPLOAD_DIR", str(BASE_DIR / "uploads" / "avatars"))
    avatar_max_size_bytes: int = int(os.getenv("AVATAR_MAX_SIZE_BYTES", str(2 * 1024 * 1024)))
    papers_upload_dir: str = os.getenv("PAPERS_UPLOAD_DIR", str(BASE_DIR / "uploads" / "papers"))
    papers_max_size_bytes: int = int(os.getenv("PAPERS_MAX_SIZE_BYTES", str(25 * 1024 * 1024)))
    translation_debug_log_enabled: bool = _env_flag("TRANSLATION_DEBUG_LOG_ENABLED", "false")
    startup_schema_sync_enabled: bool = _env_flag("STARTUP_SCHEMA_SYNC_ENABLED", "true")
    upload_mirror_enabled: bool = _env_flag("UPLOAD_MIRROR_ENABLED", "false")
    upload_mirror_remote_dir: str = os.getenv("UPLOAD_MIRROR_REMOTE_DIR", "/www/xk-reader/backend/uploads")
    upload_mirror_sftp_host: str = os.getenv("UPLOAD_MIRROR_SFTP_HOST", "")
    upload_mirror_sftp_port: int = int(os.getenv("UPLOAD_MIRROR_SFTP_PORT", "22"))
    upload_mirror_sftp_username: str = os.getenv("UPLOAD_MIRROR_SFTP_USERNAME", "")
    upload_mirror_sftp_password: str = os.getenv("UPLOAD_MIRROR_SFTP_PASSWORD", "")
    upload_mirror_timeout_seconds: int = int(os.getenv("UPLOAD_MIRROR_TIMEOUT_SECONDS", "15"))
    baidu_translate_appid: str = os.getenv("BAIDU_TRANSLATE_APPID", "")
    baidu_translate_secret: str = os.getenv("BAIDU_TRANSLATE_SECRET", "")
    aliyun_docmind_enabled: bool = os.getenv("ALIYUN_DOCMIND_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    aliyun_docmind_access_key_id: str = os.getenv("ALIYUN_DOCMIND_ACCESS_KEY_ID", "")
    aliyun_docmind_access_key_secret: str = os.getenv("ALIYUN_DOCMIND_ACCESS_KEY_SECRET", "")
    aliyun_docmind_endpoint: str = os.getenv("ALIYUN_DOCMIND_ENDPOINT", "docmind-api.cn-hangzhou.aliyuncs.com")
    aliyun_docmind_region: str = os.getenv("ALIYUN_DOCMIND_REGION", "cn-hangzhou")
    translation_engine: str = os.getenv("TRANSLATION_ENGINE", "ai").strip() or "ai"
    tencent_mt_enabled: bool = os.getenv("TENCENT_MT_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    tencent_secret_id: str = os.getenv("TENCENT_SECRET_ID", "")
    tencent_secret_key: str = os.getenv("TENCENT_SECRET_KEY", "")
    tencent_mt_region: str = os.getenv("TENCENT_MT_REGION", "ap-guangzhou")
    termbase_path: str = os.getenv("TERMBASE_PATH", str(BASE_DIR / "data" / "termbase.json"))

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
    def aliyun_docmind_available(self) -> bool:
        return bool(
            self.aliyun_docmind_enabled
            and self.aliyun_docmind_access_key_id
            and self.aliyun_docmind_access_key_secret
        )

    @property
    def tencent_mt_available(self) -> bool:
        return bool(
            self.tencent_mt_enabled
            and self.tencent_secret_id
            and self.tencent_secret_key
        )

    @property
    def smtp_available(self) -> bool:
        return bool(
            self.smtp_host
            and self.smtp_username
            and self.smtp_password
            and self.smtp_from_email
        )

    @property
    def spug_sms_available(self) -> bool:
        return bool(self.spug_sms_template_url)

    @property
    def spug_email_available(self) -> bool:
        return bool(self.spug_email_template_url)

    @property
    def huyi_sms_available(self) -> bool:
        return bool(
            self.huyi_sms_enabled
            and self.huyi_sms_api_id
            and self.huyi_sms_api_key
            and self.huyi_sms_template_id
        )

    @property
    def aliyun_sms_available(self) -> bool:
        return bool(
            self.aliyun_sms_enabled
            and self.aliyun_sms_access_key_id
            and self.aliyun_sms_access_key_secret
            and self.aliyun_sms_sign_name
            and self.aliyun_sms_template_code
        )

    @property
    def tencent_sms_available(self) -> bool:
        return bool(
            self.tencent_sms_enabled
            and self.tencent_secret_id
            and self.tencent_secret_key
            and self.tencent_sms_sdk_app_id
            and self.tencent_sms_sign_name
            and self.tencent_sms_template_id
        )

    @property
    def is_production(self) -> bool:
        return self.app_env in {"production", "prod"}

    def validate_runtime(self) -> tuple[str, ...]:
        issues: list[str] = []
        if self.is_production:
            if self.secret_key == "change-me-before-production":
                issues.append("SECRET_KEY must be set in production.")
            if self.jwt_secret_key == "change-me-before-production":
                issues.append("JWT_SECRET_KEY must be set in production.")
            if not os.getenv("DATABASE_URL", "").strip() and os.getenv("DB_PASSWORD", "123456").strip() == "123456":
                issues.append("DB_PASSWORD must be changed or DATABASE_URL must be provided in production.")
        return tuple(issues)

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
