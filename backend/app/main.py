from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.db.session import Base, engine
from app.models import User, UserAgreement, UserProfile  # noqa: F401


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
    application.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

    @application.on_event("startup")
    def create_tables() -> None:
        Base.metadata.create_all(bind=engine)

    return application


app = create_app()
