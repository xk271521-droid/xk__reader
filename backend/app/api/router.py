from fastapi import APIRouter
from app.api.routes.annotation import router as annotation_router

from app.api.routes.ai_provider import router as ai_provider_router
from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.ink_annotation import router as ink_annotation_router
from app.api.routes.note import router as note_router
from app.api.routes.paper import router as paper_router
from app.api.routes.paper_summary import router as paper_summary_router
from app.api.routes.reading_record import router as reading_record_router
from app.api.routes.research_matrix import router as research_matrix_router
from app.api.routes.resource import router as resource_router
from app.api.routes.selection import router as selection_router


api_router = APIRouter()
api_router.include_router(ai_provider_router, tags=["ai"])
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(health_router, tags=["health"])
api_router.include_router(paper_router, tags=["papers"])
api_router.include_router(paper_summary_router, tags=["paper-summaries"])
api_router.include_router(reading_record_router, tags=["reading-records"])
api_router.include_router(research_matrix_router, tags=["research-matrix"])
api_router.include_router(resource_router, tags=["resources"])
api_router.include_router(annotation_router, tags=["annotations"])
api_router.include_router(ink_annotation_router, tags=["ink-annotations"])
api_router.include_router(note_router, tags=["notes"])
api_router.include_router(selection_router, tags=["selection"])
