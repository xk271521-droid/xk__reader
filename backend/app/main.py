from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from app.api.router import api_router
from app.core.config import settings
from app.db.session import Base, SessionLocal, engine
from app.models import Annotation, AiProvider, Folder, Paper, ReadingRecord, User, UserAgreement, UserProfile  # noqa: F401


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
        Base.metadata.create_all(bind=engine)
        _ensure_system_providers()

    return application


app = create_app()
