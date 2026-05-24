from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")


class PaperLiteratureCache(Base):
    __tablename__ = "paper_literature_caches"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    result_kind: Mapped[str] = mapped_column(String(24))
    lookup_key: Mapped[str] = mapped_column(String(240))
    source: Mapped[str] = mapped_column(String(160), default="")
    payload_json: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        Index("ix_paper_literature_cache_lookup", "result_kind", "lookup_key", unique=True),
    )
