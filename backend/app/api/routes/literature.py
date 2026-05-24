from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.literature import LiteratureSearchResponse
from app.services.literature_search import compact_text, search_literature


router = APIRouter(prefix="/literature", tags=["literature"])


@router.get("/search", response_model=LiteratureSearchResponse)
def search(
    q: Annotated[str, Query(min_length=1, max_length=300)],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    sources: Annotated[list[str] | None, Query()] = None,
) -> LiteratureSearchResponse:
    query = compact_text(q)
    if not query:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Query must not be blank.",
        )

    results, selected_sources, cached = search_literature(
        query,
        limit=limit,
        sources=sources,
        db=db,
    )
    return LiteratureSearchResponse(
        query=query,
        sources=selected_sources,
        cached=cached,
        results=[result.to_schema() for result in results],
    )
