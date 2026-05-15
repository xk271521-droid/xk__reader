from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")


class ResearchMatrixRun(Base):
    __tablename__ = "research_matrix_runs"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160), default="")
    status: Mapped[str] = mapped_column(String(24), default="queued")
    stage: Mapped[str] = mapped_column(String(48), default="idle")
    paper_count: Mapped[int] = mapped_column(Integer, default=0)
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    ready_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0)
    worker_status: Mapped[str] = mapped_column(String(24), default="idle")
    worker_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    worker_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    worker_pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    worker_retry_count: Mapped[int] = mapped_column(Integer, default=0)
    last_worker_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    matrix_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    drafts_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    dashboard_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    config_json: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    refreshed_from_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
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

    papers: Mapped[list["ResearchMatrixRunPaper"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ResearchMatrixRunPaper.sort_order",
    )

    __table_args__ = (
        Index("ix_research_matrix_runs_user_created", "user_id", "created_at"),
    )


class ResearchMatrixRunPaper(Base):
    __tablename__ = "research_matrix_run_papers"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("research_matrix_runs.id", ondelete="CASCADE"), index=True)
    paper_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    title_snapshot: Mapped[str] = mapped_column(String(320), default="")
    file_name_snapshot: Mapped[str] = mapped_column(String(255), default="")
    folder_name_snapshot: Mapped[str] = mapped_column(String(120), default="")
    summary_updated_at: Mapped[str] = mapped_column(String(80), default="")
    summary_source_hash: Mapped[str] = mapped_column(String(80), default="")
    summary_status: Mapped[str] = mapped_column(String(24), default="missing")
    is_missing: Mapped[bool] = mapped_column(Boolean, default=False)
    is_stale: Mapped[bool] = mapped_column(Boolean, default=False)
    review_role: Mapped[str] = mapped_column(String(120), default="")
    batch_note: Mapped[str] = mapped_column(Text, default="")
    row_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    run: Mapped["ResearchMatrixRun"] = relationship(back_populates="papers")

    __table_args__ = (
        Index("ix_research_matrix_run_papers_run_paper", "run_id", "paper_id"),
    )
