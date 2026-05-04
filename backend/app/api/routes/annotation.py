from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Annotation, Paper, User
from app.schemas.annotation import (
    AnnotationCreate,
    AnnotationListResponse,
    AnnotationResponse,
)

router = APIRouter(prefix="/papers/{paper_id}/annotations", tags=["annotations"])


def _build_response(a: Annotation) -> AnnotationResponse:
    return AnnotationResponse(
        id=a.id,
        page_number=a.page_number,
        start_offset=a.start_offset,
        end_offset=a.end_offset,
        selected_text=a.selected_text,
        type=a.type,
        color=a.color,
        created_at=a.created_at.isoformat() if a.created_at else None,
    )


@router.get("", response_model=AnnotationListResponse)
def list_annotations(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AnnotationListResponse:
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == user.id)
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")

    annotations = db.scalars(
        select(Annotation)
        .where(Annotation.paper_id == paper_id)
        .order_by(Annotation.page_number, Annotation.start_offset)
    ).all()
    return AnnotationListResponse(
        annotations=[_build_response(a) for a in annotations]
    )


@router.post("", response_model=AnnotationResponse, status_code=status.HTTP_201_CREATED)
def create_annotation(
    paper_id: int,
    payload: AnnotationCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AnnotationResponse:
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == user.id)
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在")

    annotation = Annotation(
        user_id=user.id,
        paper_id=paper_id,
        page_number=payload.page_number,
        start_offset=payload.start_offset,
        end_offset=payload.end_offset,
        selected_text=payload.selected_text,
        type=payload.type,
        color=payload.color,
    )
    db.add(annotation)
    db.commit()
    db.refresh(annotation)
    return _build_response(annotation)


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_annotation(
    paper_id: int,
    annotation_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    annotation = db.scalar(
        select(Annotation).where(
            Annotation.id == annotation_id,
            Annotation.user_id == user.id,
        )
    )
    if not annotation:
        raise HTTPException(status_code=404, detail="标注不存在或无权删除")
    db.delete(annotation)
    db.commit()
