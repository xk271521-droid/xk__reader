from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Annotation, Paper, PaperSummary, User
from app.schemas.annotation import (
    AnnotationCreate,
    AnnotationEraseRequest,
    AnnotationListResponse,
    AnnotationResponse,
    AnnotationRestoreRequest,
)

router = APIRouter(prefix="/papers/{paper_id}/annotations", tags=["annotations"])


def _ensure_owned_paper(paper_id: int, user: User, db: Session) -> Paper:
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.user_id == user.id, Paper.deleted_at.is_(None))
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在或无权访问")
    return paper


def _parse_rects(raw: str | None) -> list[dict[str, float]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _build_response(annotation: Annotation) -> AnnotationResponse:
    return AnnotationResponse(
        id=annotation.id,
        page_number=annotation.page_number,
        start_char=annotation.start_char,
        end_char=annotation.end_char,
        quote_text=annotation.quote_text,
        rects=_parse_rects(annotation.rects_json),
        type=annotation.type,
        color=annotation.color,
        source=annotation.source,
        geometry_version=annotation.geometry_version or "v1",
        created_at=annotation.created_at.isoformat() if annotation.created_at else None,
    )


def _list_paper_annotations(paper_id: int, db: Session) -> list[Annotation]:
    return db.scalars(
        select(Annotation)
        .where(Annotation.paper_id == paper_id)
        .order_by(Annotation.page_number, Annotation.start_char, Annotation.id)
    ).all()


def _dedupe_paper_annotations(paper_id: int, db: Session) -> bool:
    annotations = _list_paper_annotations(paper_id, db)
    seen: dict[tuple[int, int, int, str, str | None], Annotation] = {}
    changed = False
    for annotation in annotations:
        key = (
            annotation.page_number,
            annotation.start_char,
            annotation.end_char,
            annotation.type,
            annotation.color,
        )
        previous = seen.get(key)
        if previous:
            db.delete(annotation)
            changed = True
            continue
        seen[key] = annotation
    return changed


def _invalidate_annotation_summary(paper_id: int, user_id: int, db: Session) -> None:
    item = db.scalar(
        select(PaperSummary).where(
            PaperSummary.paper_id == paper_id,
            PaperSummary.user_id == user_id,
            PaperSummary.summary_type == "annotations",
        )
    )
    if not item or item.status == "running":
        return
    item.status = "idle"
    item.stage = "idle"
    item.progress = 0
    item.source_hash = ""
    item.content_json = {}
    item.error_message = None
    db.add(item)


def _slice_quote_text(quote: str | None, old_start: int, old_end: int, new_start: int, new_end: int) -> str:
    text = str(quote or "")
    if not text or old_end <= old_start or new_end <= new_start:
        return ""
    span = max(1, old_end - old_start)
    left = max(0, min(len(text), round((new_start - old_start) / span * len(text))))
    right = max(left, min(len(text), round((new_end - old_start) / span * len(text))))
    return text[left:right].strip()


@router.get("", response_model=AnnotationListResponse)
def list_annotations(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AnnotationListResponse:
    _ensure_owned_paper(paper_id, user, db)
    if _dedupe_paper_annotations(paper_id, db):
        _invalidate_annotation_summary(paper_id, user.id, db)
    db.commit()
    annotations = _list_paper_annotations(paper_id, db)
    return AnnotationListResponse(
        annotations=[_build_response(annotation) for annotation in annotations]
    )


@router.post("", response_model=AnnotationResponse, status_code=status.HTTP_201_CREATED)
def create_annotation(
    paper_id: int,
    payload: AnnotationCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AnnotationResponse:
    _ensure_owned_paper(paper_id, user, db)

    annotation = Annotation(
        user_id=user.id,
        paper_id=paper_id,
        page_number=payload.page_number,
        start_char=payload.start_char,
        end_char=payload.end_char,
        quote_text=payload.quote_text,
        rects_json=json.dumps([rect.model_dump() for rect in payload.rects], ensure_ascii=False),
        type=payload.type,
        color=payload.color,
        source=payload.source,
        geometry_version=payload.geometry_version,
    )
    db.add(annotation)
    _invalidate_annotation_summary(paper_id, user.id, db)
    db.commit()
    db.refresh(annotation)
    return _build_response(annotation)


@router.post("/erase", response_model=AnnotationListResponse)
def erase_annotations(
    paper_id: int,
    payload: AnnotationEraseRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AnnotationListResponse:
    _ensure_owned_paper(paper_id, user, db)

    if payload.end_char <= payload.start_char:
        raise HTTPException(status_code=400, detail="擦除范围无效")

    annotations = db.scalars(
        select(Annotation)
        .where(
            Annotation.paper_id == paper_id,
            Annotation.page_number == payload.page_number,
            Annotation.end_char > payload.start_char,
            Annotation.start_char < payload.end_char,
        )
        .order_by(Annotation.start_char, Annotation.id)
    ).all()

    for annotation in annotations:
        old_start = annotation.start_char
        old_end = annotation.end_char
        old_quote = annotation.quote_text
        if payload.start_char <= annotation.start_char and payload.end_char >= annotation.end_char:
            db.delete(annotation)
            continue

        if payload.start_char <= annotation.start_char:
            annotation.quote_text = _slice_quote_text(old_quote, old_start, old_end, payload.end_char, old_end)
            annotation.start_char = payload.end_char
        elif payload.end_char >= annotation.end_char:
            annotation.quote_text = _slice_quote_text(old_quote, old_start, old_end, old_start, payload.start_char)
            annotation.end_char = payload.start_char
        else:
            right_quote = _slice_quote_text(old_quote, old_start, old_end, payload.end_char, old_end)
            right_piece = Annotation(
                user_id=annotation.user_id,
                paper_id=annotation.paper_id,
                page_number=annotation.page_number,
                start_char=payload.end_char,
                end_char=annotation.end_char,
                quote_text=right_quote,
                rects_json=annotation.rects_json,
                type=annotation.type,
                color=annotation.color,
                source=annotation.source,
                geometry_version="v2",
            )
            annotation.quote_text = _slice_quote_text(old_quote, old_start, old_end, old_start, payload.start_char)
            annotation.end_char = payload.start_char
            db.add(right_piece)

        annotation.geometry_version = "v2"
        db.add(annotation)

    db.commit()
    _dedupe_paper_annotations(paper_id, db)
    _invalidate_annotation_summary(paper_id, user.id, db)
    db.commit()

    updated = _list_paper_annotations(paper_id, db)
    return AnnotationListResponse(annotations=[_build_response(annotation) for annotation in updated])


@router.post("/restore", response_model=AnnotationListResponse)
def restore_annotations(
    paper_id: int,
    payload: AnnotationRestoreRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AnnotationListResponse:
    _ensure_owned_paper(paper_id, user, db)

    current_annotations = db.scalars(
        select(Annotation).where(
            Annotation.paper_id == paper_id,
            Annotation.user_id == user.id,
        )
    ).all()
    for annotation in current_annotations:
        db.delete(annotation)

    for item in payload.annotations:
        if item.end_char <= item.start_char:
            continue
        db.add(
            Annotation(
                user_id=user.id,
                paper_id=paper_id,
                page_number=item.page_number,
                start_char=item.start_char,
                end_char=item.end_char,
                quote_text=item.quote_text,
                rects_json=json.dumps([rect.model_dump() for rect in item.rects], ensure_ascii=False),
                type=item.type,
                color=item.color,
                source=item.source,
                geometry_version=item.geometry_version,
            )
        )

    _invalidate_annotation_summary(paper_id, user.id, db)
    db.commit()

    restored = _list_paper_annotations(paper_id, db)
    return AnnotationListResponse(annotations=[_build_response(annotation) for annotation in restored])


@router.delete("", response_model=AnnotationListResponse)
def clear_annotations(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AnnotationListResponse:
    _ensure_owned_paper(paper_id, user, db)

    current_annotations = db.scalars(
        select(Annotation).where(
            Annotation.paper_id == paper_id,
            Annotation.user_id == user.id,
        )
    ).all()
    for annotation in current_annotations:
        db.delete(annotation)

    _invalidate_annotation_summary(paper_id, user.id, db)
    db.commit()
    return AnnotationListResponse(annotations=[])


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_annotation(
    paper_id: int,
    annotation_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    _ensure_owned_paper(paper_id, user, db)

    annotation = db.scalar(
        select(Annotation).where(
            Annotation.id == annotation_id,
            Annotation.paper_id == paper_id,
            Annotation.user_id == user.id,
        )
    )
    if not annotation:
        raise HTTPException(status_code=404, detail="标注不存在或无权删除")

    db.delete(annotation)
    _invalidate_annotation_summary(paper_id, user.id, db)
    db.commit()
