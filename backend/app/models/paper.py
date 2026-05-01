from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")


class Folder(Base):
    __tablename__ = "folders"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    user: Mapped["User"] = relationship(back_populates="folders")
    papers: Mapped[list["Paper"]] = relationship(back_populates="folder", cascade="all, delete-orphan")


class Paper(Base):
    __tablename__ = "papers"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    folder_id: Mapped[int] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(500))
    file_size: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(300), default="")
    translated_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(300), nullable=True)
    keywords: Mapped[str | None] = mapped_column(String(300), nullable=True)
    creator: Mapped[str | None] = mapped_column(String(200), nullable=True)
    producer: Mapped[str | None] = mapped_column(String(200), nullable=True)
    creation_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    modification_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    doi: Mapped[str | None] = mapped_column(String(200), nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    last_viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    user: Mapped["User"] = relationship(back_populates="papers")
    folder: Mapped["Folder"] = relationship(back_populates="papers")

    __table_args__ = (
        # 同一用户下，文件名+大小联合唯一，防止重复导入
        # {"name": "uq_user_file"},
    )
