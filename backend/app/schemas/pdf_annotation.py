from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator

PDF_ANNOTATION_SCHEMA_VERSION = "embedpdf-v1"
ANNOTATION_UID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$"
ANNOTATION_TYPE_PATTERN = r"^[A-Za-z][A-Za-z0-9_-]{0,47}$"


class PdfAnnotationUpsert(BaseModel):
    uid: str = Field(min_length=1, max_length=128, pattern=ANNOTATION_UID_PATTERN)
    page_index: int = Field(ge=0, le=100000)
    annotation_type: str = Field(min_length=1, max_length=48, pattern=ANNOTATION_TYPE_PATTERN)
    payload: dict[str, Any]
    base_version: int = Field(default=0, ge=0)


class PdfAnnotationDelete(BaseModel):
    uid: str = Field(min_length=1, max_length=128, pattern=ANNOTATION_UID_PATTERN)
    base_version: int = Field(default=0, ge=0)


class PdfAnnotationSyncRequest(BaseModel):
    base_revision: int = Field(default=0, ge=0)
    upserts: list[PdfAnnotationUpsert] = Field(default_factory=list, max_length=500)
    deletes: list[PdfAnnotationDelete] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def validate_unique_operations(self):
        uids = [item.uid for item in self.upserts] + [item.uid for item in self.deletes]
        if len(uids) != len(set(uids)):
            raise ValueError("Each annotation UID may appear only once in a sync batch")
        return self


class PdfAnnotationRecord(BaseModel):
    uid: str
    page_index: int
    annotation_type: str
    payload: dict[str, Any]
    version: int
    created_at: str | None = None
    updated_at: str | None = None


class PdfAnnotationConflict(BaseModel):
    uid: str
    operation: str
    reason: str
    server: PdfAnnotationRecord | None = None


class PdfAnnotationDocumentResponse(BaseModel):
    schema_version: str = PDF_ANNOTATION_SCHEMA_VERSION
    revision: int
    annotations: list[PdfAnnotationRecord]
    applied_uids: list[str] = Field(default_factory=list)
    conflicts: list[PdfAnnotationConflict] = Field(default_factory=list)
    requires_refresh: bool = False
