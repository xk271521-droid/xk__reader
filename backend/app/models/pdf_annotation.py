from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")
LongTextType = Text().with_variant(LONGTEXT, "mysql")


class PdfAnnotation(Base):
    """Canonical persisted annotation created by the EmbedPDF adapter."""

    __tablename__ = "paper_pdf_annotations"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    uid: Mapped[str] = mapped_column(String(128))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    paper_id: Mapped[int] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    page_index: Mapped[int] = mapped_column(Integer, index=True)
    annotation_type: Mapped[str] = mapped_column(String(48), index=True)
    payload_json: Mapped[str] = mapped_column(LongTextType)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    __table_args__ = (
        UniqueConstraint("user_id", "paper_id", "uid", name="uq_pdf_annotation_uid"),
        Index(
            "ix_pdf_annotation_document_page",
            "user_id",
            "paper_id",
            "page_index",
            "deleted_at",
        ),
    )


class PaperAnnotationState(Base):
    """Monotonic server revision for one user's annotations on one paper."""

    __tablename__ = "paper_annotation_states"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    paper_id: Mapped[int] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    revision: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "paper_id", name="uq_paper_annotation_state"),
        Index("ix_paper_annotation_state_lookup", "user_id", "paper_id"),
    )

