from fastapi import APIRouter

from app.api.routes.ai_provider import router as ai_provider_router
from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.paper import router as paper_router
from app.api.routes.reading_record import router as reading_record_router
from app.api.routes.selection import router as selection_router


api_router = APIRouter()
api_router.include_router(ai_provider_router, tags=["ai"])
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(health_router, tags=["health"])
api_router.include_router(paper_router, tags=["papers"])
api_router.include_router(reading_record_router, tags=["reading-records"])
api_router.include_router(selection_router, tags=["selection"])
