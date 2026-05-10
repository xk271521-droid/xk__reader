from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import InkAnnotation, Paper, User
from app.schemas.ink_annotation import (
    InkAnnotationCreate,
    InkAnnotationListResponse,
    InkAnnotationResponse,
)

router = APIRouter(prefix="/papers/{paper_id}/ink-annotations", tags=["ink-annotations"])


def _ensure_owned_paper(paper_id: int, user: User, db: Session) -> Paper:
    paper = db.scalar(select(Paper).where(Paper.id == paper_id, Paper.user_id == user.id))
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper


def _parse_points(raw: str | None) -> list[dict[str, float]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _build_response(item: InkAnnotation) -> InkAnnotationResponse:
    return InkAnnotationResponse(
        id=item.id,
        page_number=item.page_number,
        color=item.color,
        opacity=float(item.opacity),
        stroke_width=float(item.stroke_width),
        points=_parse_points(item.points_json),
        created_at=item.created_at.isoformat() if item.created_at else None,
        updated_at=item.updated_at.isoformat() if item.updated_at else None,
    )


@router.get("", response_model=InkAnnotationListResponse)
def list_ink_annotations(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> InkAnnotationListResponse:
    _ensure_owned_paper(paper_id, user, db)
    items = db.scalars(
        select(InkAnnotation)
        .where(InkAnnotation.paper_id == paper_id, InkAnnotation.user_id == user.id)
        .order_by(InkAnnotation.page_number, InkAnnotation.id)
    ).all()
    return InkAnnotationListResponse(ink_annotations=[_build_response(item) for item in items])


@router.post("", response_model=InkAnnotationResponse, status_code=status.HTTP_201_CREATED)
def create_ink_annotation(
    paper_id: int,
    payload: InkAnnotationCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> InkAnnotationResponse:
    _ensure_owned_paper(paper_id, user, db)
    item = InkAnnotation(
        user_id=user.id,
        paper_id=paper_id,
        page_number=payload.page_number,
        color=payload.color,
        opacity=payload.opacity,
        stroke_width=payload.stroke_width,
        points_json=json.dumps([point.model_dump() for point in payload.points], ensure_ascii=False),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _build_response(item)


@router.delete("/{ink_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_ink_annotation(
    paper_id: int,
    ink_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    _ensure_owned_paper(paper_id, user, db)
    item = db.scalar(
        select(InkAnnotation).where(
            InkAnnotation.id == ink_id,
            InkAnnotation.paper_id == paper_id,
            InkAnnotation.user_id == user.id,
        )
    )
    if not item:
        raise HTTPException(status_code=404, detail="Ink annotation not found")
    db.delete(item)
    db.commit()
