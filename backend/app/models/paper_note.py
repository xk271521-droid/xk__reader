from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")
LongTextType = Text().with_variant(LONGTEXT, "mysql")


class PaperNotebook(Base):
    __tablename__ = "paper_notebooks"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    paper_id: Mapped[int] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="New notebook")
    template_type: Mapped[str] = mapped_column(String(20), default="blank")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    collapsed: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user = relationship("User")
    paper = relationship("Paper", back_populates="notebooks")
    nodes = relationship(
        "PaperNoteNode",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PaperNoteNode.sort_order",
    )


class PaperNoteNode(Base):
    __tablename__ = "paper_note_nodes"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    notebook_id: Mapped[int] = mapped_column(ForeignKey("paper_notebooks.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("paper_note_nodes.id", ondelete="CASCADE"), nullable=True, index=True)
    level: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(200), default="New heading")
    color_index: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    collapsed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    notebook = relationship("PaperNotebook")
    parent = relationship("PaperNoteNode", remote_side="PaperNoteNode.id")
    blocks = relationship(
        "PaperNoteBlock",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PaperNoteBlock.sort_order",
    )


class PaperNoteBlock(Base):
    __tablename__ = "paper_note_blocks"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    node_id: Mapped[int] = mapped_column(ForeignKey("paper_note_nodes.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(20), default="text")
    content: Mapped[str] = mapped_column(LongTextType, default="")
    image_url: Mapped[str | None] = mapped_column(LongTextType, nullable=True)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_char: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_char: Mapped[int | None] = mapped_column(Integer, nullable=True)
    context_before: Mapped[str] = mapped_column(LongTextType, default="")
    context_after: Mapped[str] = mapped_column(LongTextType, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    node = relationship("PaperNoteNode")
