from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")


class PaperAiOutline(Base):
    """One durable, AI-generated navigation outline for an owned paper."""

    __tablename__ = "paper_ai_outlines"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    paper_id: Mapped[int] = mapped_column(
        ForeignKey("papers.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="idle")
    stage: Mapped[str] = mapped_column(String(48), default="idle")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    source_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    source_hash: Mapped[str] = mapped_column(String(64), default="")
    prompt_version: Mapped[str] = mapped_column(String(32), default="v1")
    provider_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model: Mapped[str] = mapped_column(String(120), default="")
    content_json: Mapped[dict] = mapped_column(JSON, default=dict)
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

    paper: Mapped["Paper"] = relationship(back_populates="ai_outline")

    __table_args__ = (
        Index("ix_paper_ai_outlines_user_status_updated", "user_id", "status", "updated_at"),
    )
