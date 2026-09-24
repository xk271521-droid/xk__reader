from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.paper import Paper
from app.models.pdf_annotation import PdfAnnotation
from app.models.user import User
from app.schemas.pdf_annotation import (
    PDF_ANNOTATION_SCHEMA_VERSION,
    PdfAnnotationConflict,
    PdfAnnotationDocumentResponse,
    PdfAnnotationRecord,
    PdfAnnotationSyncRequest,
)
from app.services.pdf_annotation_sync import (
    clear_pdf_annotations,
    get_annotation_revision,
    list_active_pdf_annotations,
    parse_annotation_payload,
    sync_pdf_annotations,
)

router = APIRouter(prefix="/papers/{paper_id}/pdf-annotations", tags=["pdf-annotations"])


def _ensure_owned_paper(paper_id: int, user: User, db: Session, *, lock: bool = False) -> Paper:
    statement = select(Paper).where(
        Paper.id == paper_id,
        Paper.user_id == user.id,
        Paper.deleted_at.is_(None),
    )
    if lock:
        statement = statement.with_for_update()
    paper = db.scalar(statement)
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在或无权访问")
    return paper


def _build_record(item: PdfAnnotation) -> PdfAnnotationRecord:
    return PdfAnnotationRecord(
        uid=item.uid,
        page_index=item.page_index,
        annotation_type=item.annotation_type,
        payload=parse_annotation_payload(item.payload_json),
        version=item.version,
        created_at=item.created_at.isoformat() if item.created_at else None,
        updated_at=item.updated_at.isoformat() if item.updated_at else None,
    )


@router.get("", response_model=PdfAnnotationDocumentResponse)
def get_pdf_annotations(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PdfAnnotationDocumentResponse:
    _ensure_owned_paper(paper_id, user, db)
    revision = get_annotation_revision(db, user_id=user.id, paper_id=paper_id)
    items = list_active_pdf_annotations(db, user_id=user.id, paper_id=paper_id)
    return PdfAnnotationDocumentResponse(
        schema_version=PDF_ANNOTATION_SCHEMA_VERSION,
        revision=revision,
        annotations=[_build_record(item) for item in items],
    )


@router.post("/sync", response_model=PdfAnnotationDocumentResponse)
def sync_paper_pdf_annotations(
    paper_id: int,
    payload: PdfAnnotationSyncRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PdfAnnotationDocumentResponse:
    # Lock the owned paper row so the first state-row creation is safe under
    # concurrent sync calls on MySQL as well as SQLite development databases.
    _ensure_owned_paper(paper_id, user, db, lock=True)
    try:
        result = sync_pdf_annotations(
            db,
            user_id=user.id,
            paper_id=paper_id,
            base_revision=payload.base_revision,
            upserts=payload.upserts,
            deletes=payload.deletes,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return PdfAnnotationDocumentResponse(
        schema_version=PDF_ANNOTATION_SCHEMA_VERSION,
        revision=result.revision,
        annotations=[_build_record(item) for item in result.annotations],
        applied_uids=result.applied_uids,
        conflicts=[
            PdfAnnotationConflict(
                uid=conflict.uid,
                operation=conflict.operation,
                reason=conflict.reason,
                server=_build_record(conflict.server) if conflict.server else None,
            )
            for conflict in result.conflicts
        ],
        requires_refresh=result.requires_refresh,
    )


@router.delete("", response_model=PdfAnnotationDocumentResponse)
def clear_paper_pdf_annotations(
    paper_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PdfAnnotationDocumentResponse:
    _ensure_owned_paper(paper_id, user, db, lock=True)
    result = clear_pdf_annotations(db, user_id=user.id, paper_id=paper_id)
    return PdfAnnotationDocumentResponse(
        schema_version=PDF_ANNOTATION_SCHEMA_VERSION,
        revision=result.revision,
        annotations=[],
    )
