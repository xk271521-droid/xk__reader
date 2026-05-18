import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import OperationalError
from sqlalchemy import inspect, select, text

from app.api.router import api_router
from app.api.routes.research_matrix import resume_stale_matrix_runs
from app.core.config import settings
from app.db.session import Base, SessionLocal, engine
from app.models import Annotation, AiProvider, Folder, InkAnnotation, Notification, Paper, PaperFullTranslation, PaperNotebook, PaperNoteBlock, PaperNoteNode, PaperResourceLayout, PaperSummary, ReadingRecord, ResearchMatrixRun, ResearchMatrixRunPaper, User, UserAgreement, UserProfile, VerificationCode  # noqa: F401


def _ensure_system_providers() -> None:
    """启动时创建/更新系统默认 AI 厂商"""
    from app.services.crypto import encrypt_api_key

    db = SessionLocal()
    try:
        for idx, sp in enumerate(settings.system_providers):
            existing = db.scalar(
                select(AiProvider).where(
                    AiProvider.user_id.is_(None),
                    AiProvider.base_url == sp["base_url"],
                    AiProvider.model == sp["model"],
                )
            )
            if existing:
                existing.encrypted_api_key = encrypt_api_key(sp["api_key"])
                existing.label = sp["label"]
                existing.sort_order = sp.get("sort_order", idx)
                # 已有厂商：不改启用状态，避免覆盖用户的开关选择
            else:
                provider = AiProvider(
                    user_id=None,
                    label=sp["label"],
                    base_url=sp["base_url"],
                    encrypted_api_key=encrypt_api_key(sp["api_key"]),
                    model=sp["model"],
                    sort_order=sp.get("sort_order", idx),
                    is_active=(idx == 0),  # 只有第一个默认启用
                )
                db.add(provider)

        # 迁移修复：如果有多个系统厂商同时启用，只保留第一个
        system_providers = db.scalars(
            select(AiProvider).where(
                AiProvider.user_id.is_(None),
                AiProvider.is_active.is_(True),
            ).order_by(AiProvider.sort_order, AiProvider.id)
        ).all()
        if len(system_providers) > 1:
            for p in system_providers[1:]:
                p.is_active = False
        db.commit()
    finally:
        db.close()


def _ensure_annotation_geometry_version_column() -> None:
    inspector = inspect(engine)
    try:
        columns = {column["name"] for column in inspector.get_columns("annotations_v2")}
    except Exception:
        return

    if "geometry_version" in columns:
        return

    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            connection.execute(
                text("ALTER TABLE annotations_v2 ADD COLUMN geometry_version VARCHAR(12) DEFAULT 'v1'")
            )
        else:
            connection.execute(
                text("ALTER TABLE annotations_v2 ADD COLUMN geometry_version VARCHAR(12) NOT NULL DEFAULT 'v1'")
            )


def _ensure_full_translation_parse_columns() -> None:
    inspector = inspect(engine)
    try:
        columns = {column["name"] for column in inspector.get_columns("paper_full_translations")}
    except Exception:
        return

    additions = [
        ("parse_mode", "VARCHAR(24)", "'auto'"),
        ("parse_engine", "VARCHAR(24)", "'local'"),
        ("parse_summary", "JSON" if engine.dialect.name != "sqlite" else "TEXT", None),
        ("translation_engine", "VARCHAR(32)", "'ai'"),
        ("termbase_version", "VARCHAR(64)", "''"),
    ]
    with engine.begin() as connection:
        for name, column_type, default in additions:
            if name in columns:
                continue
            if default:
                connection.execute(
                    text(f"ALTER TABLE paper_full_translations ADD COLUMN {name} {column_type} NOT NULL DEFAULT {default}")
                )
            else:
                connection.execute(
                    text(f"ALTER TABLE paper_full_translations ADD COLUMN {name} {column_type}")
                )
                if name == "parse_summary":
                    connection.execute(
                        text("UPDATE paper_full_translations SET parse_summary = '{}' WHERE parse_summary IS NULL")
                    )


def _ensure_paper_trash_columns() -> None:
    inspector = inspect(engine)
    try:
        columns = {column["name"] for column in inspector.get_columns("papers")}
    except Exception:
        return

    with engine.begin() as connection:
        if "deleted_at" not in columns:
            connection.execute(text("ALTER TABLE papers ADD COLUMN deleted_at DATETIME NULL"))
        if "deleted_original_folder_id" not in columns:
            connection.execute(text("ALTER TABLE papers ADD COLUMN deleted_original_folder_id INTEGER NULL"))


def _ensure_research_matrix_columns() -> None:
    inspector = inspect(engine)
    try:
        run_columns = {column["name"] for column in inspector.get_columns("research_matrix_runs")}
        run_paper_columns = {column["name"] for column in inspector.get_columns("research_matrix_run_papers")}
    except Exception:
        return

    run_additions = [
        ("stage", "VARCHAR(48)", "'idle'"),
        ("total_count", "INTEGER", "0"),
        ("ready_count", "INTEGER", "0"),
        ("failed_count", "INTEGER", "0"),
        ("progress_percent", "INTEGER", "0"),
        ("worker_status", "VARCHAR(24)", "'idle'"),
        ("worker_started_at", "DATETIME", None),
        ("worker_heartbeat_at", "DATETIME", None),
        ("worker_pid", "INTEGER", None),
        ("worker_retry_count", "INTEGER", "0"),
        ("last_worker_error", "TEXT", None),
    ]
    run_paper_additions = [
        ("review_role", "VARCHAR(120)", "''"),
        ("batch_note", "TEXT", None),
    ]
    with engine.begin() as connection:
        for name, column_type, default in run_additions:
            if name in run_columns:
                continue
            if default is None:
                connection.execute(
                    text(
                        f"ALTER TABLE research_matrix_runs ADD COLUMN {name} {column_type} NULL"
                    )
                )
            else:
                connection.execute(
                    text(
                        f"ALTER TABLE research_matrix_runs ADD COLUMN {name} {column_type} "
                        f"NOT NULL DEFAULT {default}"
                    )
                )
        for name, column_type, default in run_paper_additions:
            if name in run_paper_columns:
                continue
            if default is None:
                connection.execute(
                    text(
                        f"ALTER TABLE research_matrix_run_papers ADD COLUMN {name} {column_type} NULL"
                    )
                )
            else:
                connection.execute(
                    text(
                        f"ALTER TABLE research_matrix_run_papers ADD COLUMN {name} {column_type} "
                        f"NOT NULL DEFAULT {default}"
                    )
                )


def _ensure_reading_record_duration_column() -> None:
    inspector = inspect(engine)
    try:
        columns = {column["name"] for column in inspector.get_columns("reading_records")}
    except Exception:
        return

    if "duration_seconds" in columns:
        return

    with engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE reading_records ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0")
        )


def _ensure_user_email_nullable() -> None:
    inspector = inspect(engine)
    try:
        columns = {column["name"]: column for column in inspector.get_columns("users")}
    except Exception:
        return

    email_column = columns.get("email")
    if not email_column or email_column.get("nullable"):
        return

    if engine.dialect.name == "sqlite":
        return

    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NULL"))


def _ensure_user_admin_column() -> None:
    inspector = inspect(engine)
    try:
        columns = {column["name"] for column in inspector.get_columns("users")}
    except Exception:
        return

    if "is_admin" in columns:
        return

    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            connection.execute(
                text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0")
            )
        else:
            connection.execute(
                text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE")
            )


def _ensure_user_token_version_column() -> None:
    inspector = inspect(engine)
    try:
        columns = {column["name"] for column in inspector.get_columns("users")}
    except Exception:
        return

    if "token_version" in columns:
        return

    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            connection.execute(
                text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0")
            )
        else:
            connection.execute(
                text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0")
            )


def _is_retryable_startup_ddl_error(exc: OperationalError) -> bool:
    original = getattr(exc, "orig", None)
    error_code = None
    if original is not None and getattr(original, "args", None):
        error_code = original.args[0]
    message = str(original or exc).lower()
    return (
        error_code in {1412, 1684, 2006, 2013}
        or "concurrent ddl" in message
        or "being modified" in message
        or "server has gone away" in message
        or "lost connection to mysql server during query" in message
    )


def _run_startup_schema_sync() -> None:
    attempts = 5
    delay_seconds = 1.5
    for attempt in range(1, attempts + 1):
        try:
            Base.metadata.create_all(bind=engine)
            _ensure_annotation_geometry_version_column()
            _ensure_full_translation_parse_columns()
            _ensure_paper_trash_columns()
            _ensure_research_matrix_columns()
            _ensure_reading_record_duration_column()
            _ensure_user_email_nullable()
            _ensure_user_admin_column()
            _ensure_user_token_version_column()
            return
        except OperationalError as exc:
            if attempt == attempts or not _is_retryable_startup_ddl_error(exc):
                raise
            time.sleep(delay_seconds)


def create_app() -> FastAPI:
    application = FastAPI(title=settings.app_name)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(api_router, prefix="/api")
    uploads_dir = Path(settings.uploads_dir)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    Path(settings.avatar_upload_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.papers_upload_dir).mkdir(parents=True, exist_ok=True)
    application.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

    @application.on_event("startup")
    def create_tables() -> None:
        _run_startup_schema_sync()
        _ensure_system_providers()
        resume_stale_matrix_runs()

    return application


app = create_app()
