from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")
LongTextType = Text().with_variant(LONGTEXT, "mysql")


class InkAnnotation(Base):
    __tablename__ = "paper_ink_annotations"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    paper_id: Mapped[int] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    page_number: Mapped[int] = mapped_column(Integer, index=True)
    color: Mapped[str] = mapped_column(String(20), default="#15803D")
    opacity: Mapped[float] = mapped_column(Float, default=0.85)
    stroke_width: Mapped[float] = mapped_column(Float, default=6.0)
    points_json: Mapped[str] = mapped_column(LongTextType)
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

    user: Mapped["User"] = relationship(back_populates="ink_annotations")
    paper: Mapped["Paper"] = relationship(back_populates="ink_annotations")

    __table_args__ = (
        Index("ix_paper_ink_lookup", "user_id", "paper_id", "page_number"),
    )
