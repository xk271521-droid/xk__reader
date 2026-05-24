from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")


class TaskCenterArchive(Base):
    __tablename__ = "task_center_archives"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[str] = mapped_column(String(120))
    source_kind: Mapped[str] = mapped_column(String(40))
    source_id: Mapped[int] = mapped_column(Integer)
    archived_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "task_id", name="uq_task_center_archives_user_task"),
        Index("ix_task_center_archives_user_source", "user_id", "source_kind", "source_id"),
        Index("ix_task_center_archives_user_archived", "user_id", "archived_at"),
    )
