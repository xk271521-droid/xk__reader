from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")


class PaperResourceLayout(Base):
    __tablename__ = "paper_resource_layouts"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    paper_id: Mapped[int] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    resource_type: Mapped[str] = mapped_column(String(64))
    x_pct: Mapped[float] = mapped_column(Float)
    y_pct: Mapped[float] = mapped_column(Float)
    rotation_deg: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    user: Mapped["User"] = relationship(back_populates="resource_layouts")
    paper: Mapped["Paper"] = relationship(back_populates="resource_layouts")

    __table_args__ = (
        UniqueConstraint("user_id", "paper_id", "resource_type", name="uq_paper_resource_layout"),
        Index("ix_paper_resource_layout_lookup", "user_id", "paper_id", "resource_type"),
    )
