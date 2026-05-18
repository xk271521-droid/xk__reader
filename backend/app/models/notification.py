from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source_kind: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[int] = mapped_column(Integer)
    event_kind: Mapped[str] = mapped_column(String(24))
    title: Mapped[str] = mapped_column(String(160), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    action_kind: Mapped[str] = mapped_column(String(48))
    action_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    __table_args__ = (
        Index("ix_notifications_user_created", "user_id", "created_at"),
    )
