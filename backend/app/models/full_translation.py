from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")


class PaperFullTranslation(Base):
    __tablename__ = "paper_full_translations"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    paper_id: Mapped[int] = mapped_column(
        ForeignKey("papers.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    provider_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_hash: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(24), default="idle")
    parse_mode: Mapped[str] = mapped_column(String(24), default="auto")
    parse_engine: Mapped[str] = mapped_column(String(24), default="local")
    parse_summary: Mapped[dict] = mapped_column(JSON, default=dict)
    translation_engine: Mapped[str] = mapped_column(String(32), default="ai")
    termbase_version: Mapped[str] = mapped_column(String(64), default="")
    # The translated PDF is the product record. `pages_json` remains only for
    # backwards compatibility with the retired browser block-translation beta.
    artifact_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    artifact_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    artifact_size: Mapped[int] = mapped_column(BigInteger, default=0)
    generation_version: Mapped[int] = mapped_column(Integer, default=0)
    pages_json: Mapped[list] = mapped_column(JSON, default=list)
    completed_units: Mapped[int] = mapped_column(Integer, default=0)
    total_units: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    paper: Mapped["Paper"] = relationship(back_populates="full_translation")

    __table_args__ = (
        Index("ix_paper_full_translations_status_updated", "status", "updated_at"),
    )
