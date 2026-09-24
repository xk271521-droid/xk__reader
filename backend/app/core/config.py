from __future__ import annotations

import os
from pathlib import Path
from dataclasses import dataclass, field
from urllib.parse import quote_plus

from dotenv import load_dotenv
from sqlalchemy.engine import make_url

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env", encoding="utf-8-sig")
load_dotenv(BASE_DIR / ".env.local", encoding="utf-8-sig", override=True)


def _split_csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _env_flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _standalone_runtime_enabled() -> bool:
    """Return whether the packaged desktop backend owns its local data."""
    return _env_flag("XK_READER_STANDALONE", "false")


def _runtime_data_dir() -> Path:
    configured = os.getenv("XK_READER_DATA_DIR", "").strip()
    return Path(configured).expanduser() if configured else BASE_DIR / "data"


def _rewrite_database_url_for_local_runtime(database_url: str) -> str:
    """Reuse configured credentials while keeping a standalone install local."""
    if not _env_flag("XK_READER_USE_LOCAL_DATABASE"):
        return database_url

    parsed_url = make_url(database_url)
    if parsed_url.get_backend_name() == "sqlite":
        return database_url

    host = os.getenv("XK_READER_LOCAL_DATABASE_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port_value = os.getenv("XK_READER_LOCAL_DATABASE_PORT", "3306").strip() or "3306"
    try:
        port = int(port_value)
    except ValueError as exc:
        raise ValueError("XK_READER_LOCAL_DATABASE_PORT must be an integer.") from exc

    return parsed_url.set(host=host, port=port).render_as_string(hide_password=False)


def _build_database_url() -> str:
    if _standalone_runtime_enabled():
        data_dir = _runtime_data_dir()
        data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{(data_dir / 'xk-reader.sqlite3').as_posix()}"

    explicit_url = os.getenv("DATABASE_URL", "").strip()
    if explicit_url:
        return _rewrite_database_url_for_local_runtime(explicit_url)

    driver = os.getenv("DB_DRIVER", "mysql+pymysql").strip() or "mysql+pymysql"
    user = quote_plus(os.getenv("DB_USER", "root"))
    password = quote_plus(os.getenv("DB_PASSWORD", "123456"))
    host = os.getenv("DB_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = os.getenv("DB_PORT", "3306").strip() or "3306"
    name = os.getenv("DB_NAME", "xk_reader").strip() or "xk_reader"
    charset = os.getenv("DB_CHARSET", "utf8mb4").strip() or "utf8mb4"
    return _rewrite_database_url_for_local_runtime(
        f"{driver}://{user}:{password}@{host}:{port}/{name}?charset={charset}"
    )


@dataclass(frozen=True)
class Settings:
    app_name: str = "Paper Reader MVP API"
    app_env: str = os.getenv("APP_ENV", "development").strip().lower() or "development"
    standalone_runtime: bool = _standalone_runtime_enabled()
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
    access_token_remember_minutes: int = int(
        os.getenv("ACCESS_TOKEN_REMEMBER_MINUTES", "43200")
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
    uploads_dir: str = os.getenv("UPLOADS_DIR", str(_runtime_data_dir() / "uploads"))
    avatar_upload_dir: str = os.getenv("AVATAR_UPLOAD_DIR", str(_runtime_data_dir() / "uploads" / "avatars"))
    avatar_max_size_bytes: int = int(os.getenv("AVATAR_MAX_SIZE_BYTES", str(2 * 1024 * 1024)))
    feedback_image_upload_dir: str = os.getenv("FEEDBACK_IMAGE_UPLOAD_DIR", str(_runtime_data_dir() / "uploads" / "feedback"))
    feedback_image_max_size_bytes: int = int(os.getenv("FEEDBACK_IMAGE_MAX_SIZE_BYTES", str(4 * 1024 * 1024)))
    papers_upload_dir: str = os.getenv("PAPERS_UPLOAD_DIR", str(_runtime_data_dir() / "uploads" / "papers"))
    upload_public_base_url: str = (
        ""
        if _env_flag("XK_READER_USE_LOCAL_DATABASE")
        else os.getenv("UPLOAD_PUBLIC_BASE_URL", "").rstrip("/")
    )
    papers_max_size_bytes: int = int(os.getenv("PAPERS_MAX_SIZE_BYTES", str(100 * 1024 * 1024)))
    full_translation_enabled: bool = _env_flag("FULL_TRANSLATION_ENABLED", "false")
    full_translation_output_dir: str = os.getenv(
        "FULL_TRANSLATION_OUTPUT_DIR",
        str(_runtime_data_dir() / "uploads" / "full-translations"),
    )
    # PDFMathTranslate lives in a dedicated Python 3.11/3.12 runtime rather
    # than the API process.  This avoids coupling its renderer dependencies to
    # the web backend (currently deployed on Python 3.10).
    pdfmathtranslate_command: str = os.getenv("PDFMATHTRANSLATE_COMMAND", "").strip()
    pdfmathtranslate_args: str = os.getenv(
        "PDFMATHTRANSLATE_ARGS",
        "--babeldoc --thread {thread} -li {source_lang} -lo {target_lang} -s {service} -o {output_dir} {input_pdf}",
    )
    pdfmathtranslate_source_lang: str = os.getenv("PDFMATHTRANSLATE_SOURCE_LANG", "en").strip() or "en"
    pdfmathtranslate_target_lang: str = os.getenv("PDFMATHTRANSLATE_TARGET_LANG", "zh").strip() or "zh"
    # This is PDFMathTranslate's per-document translation concurrency.  Three
    # parallel requests are a safe speed/limit balance for the active Flash
    # providers; deployers can lower it for stricter provider quotas.
    pdfmathtranslate_thread: int = max(1, int(os.getenv("PDFMATHTRANSLATE_THREAD", "3")))
    pdfmathtranslate_timeout_seconds: int = int(os.getenv("PDFMATHTRANSLATE_TIMEOUT_SECONDS", "3600"))
    pdfmathtranslate_output_glob: str = os.getenv("PDFMATHTRANSLATE_OUTPUT_GLOB", "*.pdf").strip() or "*.pdf"
    translation_debug_log_enabled: bool = _env_flag("TRANSLATION_DEBUG_LOG_ENABLED", "false")
    startup_schema_sync_enabled: bool = _env_flag("STARTUP_SCHEMA_SYNC_ENABLED", "true")
    upload_mirror_enabled: bool = (
        not _env_flag("XK_READER_USE_LOCAL_DATABASE")
        and _env_flag("UPLOAD_MIRROR_ENABLED", "false")
    )
    upload_mirror_remote_dir: str = os.getenv("UPLOAD_MIRROR_REMOTE_DIR", "/www/xk-reader/backend/uploads")
    upload_mirror_sftp_host: str = os.getenv("UPLOAD_MIRROR_SFTP_HOST", "")
    upload_mirror_sftp_port: int = int(os.getenv("UPLOAD_MIRROR_SFTP_PORT", "22"))
    upload_mirror_sftp_username: str = os.getenv("UPLOAD_MIRROR_SFTP_USERNAME", "")
    upload_mirror_sftp_password: str = os.getenv("UPLOAD_MIRROR_SFTP_PASSWORD", "")
    upload_mirror_timeout_seconds: int = int(os.getenv("UPLOAD_MIRROR_TIMEOUT_SECONDS", "15"))
    oss_enabled: bool = (
        not _env_flag("XK_READER_USE_LOCAL_DATABASE")
        and _env_flag("OSS_ENABLED", "false")
    )
    oss_endpoint: str = os.getenv("OSS_ENDPOINT", "").strip()
    oss_bucket_name: str = os.getenv("OSS_BUCKET_NAME", "").strip()
    oss_access_key_id: str = os.getenv("OSS_ACCESS_KEY_ID", "").strip()
    oss_access_key_secret: str = os.getenv("OSS_ACCESS_KEY_SECRET", "").strip()
    oss_key_prefix: str = os.getenv("OSS_KEY_PREFIX", "xk-reader").strip().strip("/")
    oss_signed_url_enabled: bool = _env_flag("OSS_SIGNED_URL_ENABLED", "true")
    oss_signed_url_expire_seconds: int = int(os.getenv("OSS_SIGNED_URL_EXPIRE_SECONDS", "3600"))
    oss_public_base_url: str = os.getenv("OSS_PUBLIC_BASE_URL", "").rstrip("/")
    oss_direct_download_enabled: bool = _env_flag("OSS_DIRECT_DOWNLOAD_ENABLED", "true")
    oss_page_image_cache_enabled: bool = _env_flag("OSS_PAGE_IMAGE_CACHE_ENABLED", "true")
    oss_page_image_prefix: str = os.getenv("OSS_PAGE_IMAGE_PREFIX", "paper-pages").strip().strip("/")
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
    termbase_path: str = os.getenv("TERMBASE_PATH", str(_runtime_data_dir() / "termbase.json"))

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
    def oss_available(self) -> bool:
        return bool(
            self.oss_enabled
            and self.oss_endpoint
            and self.oss_bucket_name
            and self.oss_access_key_id
            and self.oss_access_key_secret
        )

    @property
    def tencent_mt_available(self) -> bool:
        return bool(
            self.tencent_mt_enabled
            and self.tencent_secret_id
            and self.tencent_secret_key
        )

    @property
    def pdfmathtranslate_available(self) -> bool:
        return bool(self.pdfmathtranslate_command)

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
                "label": "智谱 GLM-4.7 Flash (官方)",
                "base_url": "https://open.bigmodel.cn/api/paas/v4",
                "api_key": self.default_glm_api_key,
                "model": "glm-4.7-flash",
                "sort_order": 0,
            })
        if self.default_deepseek_api_key:
            providers.append({
                "label": "DeepSeek V4 Flash (官方)",
                "base_url": "https://api.deepseek.com",
                "api_key": self.default_deepseek_api_key,
                "model": "deepseek-v4-flash",
                "sort_order": 1,
            })
        return providers


settings = Settings()
