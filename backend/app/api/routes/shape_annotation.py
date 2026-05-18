from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Paper, ShapeAnnotation, User
from app.schemas.shape_annotation import (
    ShapeAnnotationCreate,
    ShapeAnnotationListResponse,
    ShapeAnnotationResponse,
    ShapeAnnotationUpdate,
)

router = APIRouter(prefix="/papers/{paper_id}/shape-annotations", tags=["shape-annotations"])


def _ensure_owned_paper(paper_id: int, user: User, db: Session) -> Paper:
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == user.id, Paper.deleted_at.is_(None))
    )
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper


def _parse_json_dict(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _serialize_json_dict(payload: dict[str, Any] | None) -> str:
    if not payload:
        return "{}"
    return json.dumps(payload, ensure_ascii=False)


def _clamp_unit(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _normalize_box(x: float, y: float, width: float, height: float) -> tuple[float, float, float, float]:
    next_x = _clamp_unit(x)
    next_y = _clamp_unit(y)
    next_width = max(0.0, min(1.0 - next_x, float(width)))
    next_height = max(0.0, min(1.0 - next_y, float(height)))
    return next_x, next_y, next_width, next_height


def _build_response(item: ShapeAnnotation) -> ShapeAnnotationResponse:
    return ShapeAnnotationResponse(
        id=item.id,
        page_number=item.page_number,
        type=item.type,
        x=float(item.x),
        y=float(item.y),
        width=float(item.width),
        height=float(item.height),
        content=item.content,
        style=_parse_json_dict(item.style_json),
        extra=_parse_json_dict(item.extra_json),
        sort_order=int(item.sort_order or 0),
        created_at=item.created_at.isoformat() if item.created_at else None,
        updated_at=item.updated_at.isoformat() if item.updated_at else None,
    )


@router.get("", response_model=ShapeAnnotationListResponse)
def list_shape_annotations(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ShapeAnnotationListResponse:
    _ensure_owned_paper(paper_id, user, db)
    items = db.scalars(
        select(ShapeAnnotation)
        .where(ShapeAnnotation.paper_id == paper_id, ShapeAnnotation.user_id == user.id)
        .order_by(ShapeAnnotation.page_number, ShapeAnnotation.sort_order, ShapeAnnotation.id)
    ).all()
    return ShapeAnnotationListResponse(shape_annotations=[_build_response(item) for item in items])


@router.post("", response_model=ShapeAnnotationResponse, status_code=status.HTTP_201_CREATED)
def create_shape_annotation(
    paper_id: int,
    payload: ShapeAnnotationCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ShapeAnnotationResponse:
    _ensure_owned_paper(paper_id, user, db)
    x, y, width, height = _normalize_box(payload.x, payload.y, payload.width, payload.height)
    item = ShapeAnnotation(
        user_id=user.id,
        paper_id=paper_id,
        page_number=payload.page_number,
        type=payload.type,
        x=x,
        y=y,
        width=width,
        height=height,
        content=payload.content,
        style_json=_serialize_json_dict(payload.style),
        extra_json=_serialize_json_dict(payload.extra),
        sort_order=payload.sort_order,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _build_response(item)


@router.patch("/{annotation_id}", response_model=ShapeAnnotationResponse)
def update_shape_annotation(
    paper_id: int,
    annotation_id: int,
    payload: ShapeAnnotationUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ShapeAnnotationResponse:
    _ensure_owned_paper(paper_id, user, db)
    item = db.scalar(
        select(ShapeAnnotation).where(
            ShapeAnnotation.id == annotation_id,
            ShapeAnnotation.paper_id == paper_id,
            ShapeAnnotation.user_id == user.id,
        )
    )
    if not item:
        raise HTTPException(status_code=404, detail="Shape annotation not found")

    next_x = payload.x if payload.x is not None else item.x
    next_y = payload.y if payload.y is not None else item.y
    next_width = payload.width if payload.width is not None else item.width
    next_height = payload.height if payload.height is not None else item.height
    item.x, item.y, item.width, item.height = _normalize_box(next_x, next_y, next_width, next_height)

    if payload.content is not None:
        item.content = payload.content
    if payload.style is not None:
        item.style_json = _serialize_json_dict(payload.style)
    if payload.extra is not None:
        item.extra_json = _serialize_json_dict(payload.extra)
    if payload.sort_order is not None:
        item.sort_order = payload.sort_order

    db.add(item)
    db.commit()
    db.refresh(item)
    return _build_response(item)


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_shape_annotation(
    paper_id: int,
    annotation_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    _ensure_owned_paper(paper_id, user, db)
    item = db.scalar(
        select(ShapeAnnotation).where(
            ShapeAnnotation.id == annotation_id,
            ShapeAnnotation.paper_id == paper_id,
            ShapeAnnotation.user_id == user.id,
        )
    )
    if not item:
        raise HTTPException(status_code=404, detail="Shape annotation not found")
    db.delete(item)
    db.commit()
