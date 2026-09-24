from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.pdf_annotation import PaperAnnotationState, PdfAnnotation
from app.schemas.pdf_annotation import PdfAnnotationDelete, PdfAnnotationUpsert

MAX_ANNOTATION_PAYLOAD_BYTES = 256 * 1024
SUPPORTED_ANNOTATION_TYPES = {
    "highlight",
    "underline",
    "strikeout",
    "squiggly",
    "insertText",
    "replaceText",
    "ink",
    "inkHighlighter",
    "circle",
    "square",
    "line",
    "lineArrow",
    "polyline",
    "polygon",
    "textComment",
    "freeText",
    "freeTextCallout",
    "stamp",
    "link",
    "pin",
}


@dataclass
class SyncConflict:
    uid: str
    operation: str
    reason: str
    server: PdfAnnotation | None = None


@dataclass
class SyncResult:
    revision: int
    annotations: list[PdfAnnotation]
    applied_uids: list[str] = field(default_factory=list)
    conflicts: list[SyncConflict] = field(default_factory=list)
    requires_refresh: bool = False


def serialize_annotation_payload(payload: dict[str, Any]) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )
    if len(serialized.encode("utf-8")) > MAX_ANNOTATION_PAYLOAD_BYTES:
        raise ValueError("Annotation payload is too large")
    return serialized


def parse_annotation_payload(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def get_or_create_annotation_state(
    db: Session,
    *,
    user_id: int,
    paper_id: int,
    lock: bool = False,
) -> PaperAnnotationState:
    statement = select(PaperAnnotationState).where(
        PaperAnnotationState.user_id == user_id,
        PaperAnnotationState.paper_id == paper_id,
    )
    if lock:
        statement = statement.with_for_update()
    state = db.scalar(statement)
    if state:
        return state

    state = PaperAnnotationState(user_id=user_id, paper_id=paper_id, revision=0)
    db.add(state)
    db.flush()
    return state


def get_annotation_revision(db: Session, *, user_id: int, paper_id: int) -> int:
    """Read the document revision without creating a row.

    GET requests may run concurrently in React development mode or in multiple
    browser tabs. Creating state during a read caused both requests to insert
    the same unique `(user_id, paper_id)` row and made one request fail with
    HTTP 500. The first write remains responsible for creating the state row
    while holding the owned paper lock.
    """
    revision = db.scalar(
        select(PaperAnnotationState.revision).where(
            PaperAnnotationState.user_id == user_id,
            PaperAnnotationState.paper_id == paper_id,
        )
    )
    return int(revision or 0)


def list_active_pdf_annotations(db: Session, *, user_id: int, paper_id: int) -> list[PdfAnnotation]:
    return db.scalars(
        select(PdfAnnotation)
        .where(
            PdfAnnotation.user_id == user_id,
            PdfAnnotation.paper_id == paper_id,
            PdfAnnotation.deleted_at.is_(None),
        )
        .order_by(PdfAnnotation.page_index, PdfAnnotation.id)
    ).all()


def _load_annotation_map(db: Session, *, user_id: int, paper_id: int) -> dict[str, PdfAnnotation]:
    items = db.scalars(
        select(PdfAnnotation).where(
            PdfAnnotation.user_id == user_id,
            PdfAnnotation.paper_id == paper_id,
        )
    ).all()
    return {item.uid: item for item in items}


def _is_idempotent_upsert(item: PdfAnnotation, *, payload_json: str, operation: PdfAnnotationUpsert) -> bool:
    return (
        item.deleted_at is None
        and item.version == operation.base_version + 1
        and item.page_index == operation.page_index
        and item.annotation_type == operation.annotation_type
        and item.payload_json == payload_json
    )


def sync_pdf_annotations(
    db: Session,
    *,
    user_id: int,
    paper_id: int,
    base_revision: int,
    upserts: list[PdfAnnotationUpsert],
    deletes: list[PdfAnnotationDelete],
) -> SyncResult:
    """Apply a compact annotation operation batch with per-record version checks.

    The document revision can legitimately be stale when another device changed an
    unrelated annotation. Per-record versions prevent lost updates while still
    allowing the independent operation to succeed.
    """

    state = get_or_create_annotation_state(db, user_id=user_id, paper_id=paper_id, lock=True)
    initial_revision = int(state.revision or 0)
    if base_revision > initial_revision:
        raise ValueError("Client annotation revision is ahead of the server")

    annotation_map = _load_annotation_map(db, user_id=user_id, paper_id=paper_id)
    applied_uids: list[str] = []
    conflicts: list[SyncConflict] = []
    changed = False

    for operation in upserts:
        if operation.annotation_type not in SUPPORTED_ANNOTATION_TYPES:
            conflicts.append(SyncConflict(
                uid=operation.uid,
                operation="upsert",
                reason="unsupported_annotation_type",
            ))
            continue

        payload_json = serialize_annotation_payload(operation.payload)
        item = annotation_map.get(operation.uid)
        if item is None:
            if operation.base_version != 0:
                conflicts.append(SyncConflict(
                    uid=operation.uid,
                    operation="upsert",
                    reason="missing_server_annotation",
                ))
                continue
            item = PdfAnnotation(
                uid=operation.uid,
                user_id=user_id,
                paper_id=paper_id,
                page_index=operation.page_index,
                annotation_type=operation.annotation_type,
                payload_json=payload_json,
                version=1,
            )
            db.add(item)
            db.flush()
            annotation_map[item.uid] = item
            applied_uids.append(item.uid)
            changed = True
            continue

        if item.version != operation.base_version:
            if _is_idempotent_upsert(item, payload_json=payload_json, operation=operation):
                applied_uids.append(item.uid)
                continue
            conflicts.append(SyncConflict(
                uid=operation.uid,
                operation="upsert",
                reason="version_conflict",
                server=item,
            ))
            continue

        item.page_index = operation.page_index
        item.annotation_type = operation.annotation_type
        item.payload_json = payload_json
        item.deleted_at = None
        item.version += 1
        db.add(item)
        applied_uids.append(item.uid)
        changed = True

    now = datetime.now(timezone.utc)
    for operation in deletes:
        item = annotation_map.get(operation.uid)
        if item is None:
            if operation.base_version != 0:
                conflicts.append(SyncConflict(
                    uid=operation.uid,
                    operation="delete",
                    reason="missing_server_annotation",
                ))
                continue
            # An offline annotation may be deleted before its create request reaches
            # the server. Persisting a tombstone prevents a stale device from later
            # resurrecting that UID with a base version of zero.
            item = PdfAnnotation(
                uid=operation.uid,
                user_id=user_id,
                paper_id=paper_id,
                page_index=0,
                annotation_type="deleted",
                payload_json="{}",
                version=1,
                deleted_at=now,
            )
            db.add(item)
            db.flush()
            annotation_map[item.uid] = item
            applied_uids.append(operation.uid)
            changed = True
            continue

        if item.deleted_at is not None and item.version == operation.base_version + 1:
            applied_uids.append(operation.uid)
            continue

        if item.version != operation.base_version:
            conflicts.append(SyncConflict(
                uid=operation.uid,
                operation="delete",
                reason="version_conflict",
                server=item if item.deleted_at is None else None,
            ))
            continue

        if item.deleted_at is None:
            item.deleted_at = now
            item.version += 1
            db.add(item)
            changed = True
        applied_uids.append(operation.uid)

    if changed:
        state.revision = initial_revision + 1
        db.add(state)
    db.commit()

    return SyncResult(
        revision=int(state.revision or 0),
        annotations=list_active_pdf_annotations(db, user_id=user_id, paper_id=paper_id),
        applied_uids=applied_uids,
        conflicts=conflicts,
        requires_refresh=base_revision != initial_revision or bool(conflicts),
    )


def clear_pdf_annotations(db: Session, *, user_id: int, paper_id: int) -> SyncResult:
    state = get_or_create_annotation_state(db, user_id=user_id, paper_id=paper_id, lock=True)
    items = list_active_pdf_annotations(db, user_id=user_id, paper_id=paper_id)
    if items:
        now = datetime.now(timezone.utc)
        for item in items:
            item.deleted_at = now
            item.version += 1
            db.add(item)
        state.revision = int(state.revision or 0) + 1
        db.add(state)
    db.commit()
    return SyncResult(revision=int(state.revision or 0), annotations=[])
