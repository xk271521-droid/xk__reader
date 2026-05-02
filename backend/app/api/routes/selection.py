from fastapi import APIRouter, HTTPException

from app.schemas.selection import (
    SelectionInsightRequest,
    SelectionInsightResponse,
)
from app.services.selection_insight import build_selection_insight


router = APIRouter()


@router.post("/selection-insight", response_model=SelectionInsightResponse)
def selection_insight(
    payload: SelectionInsightRequest,
) -> SelectionInsightResponse:
    text = payload.text.strip()
    if len(text) < 2:
        raise HTTPException(status_code=400, detail="Selected text is too short.")

    return build_selection_insight(
        text=text,
        paper_title=payload.paper_title,
        domain=payload.domain,
        summary=payload.summary,
        context=payload.context or "",
        provider_id=payload.provider_id,
    )
