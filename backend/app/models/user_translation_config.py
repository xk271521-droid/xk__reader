from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

PrimaryKeyType = BigInteger().with_variant(Integer, "sqlite")


class UserTranslationConfig(Base):
    __tablename__ = "user_translation_configs"

    id: Mapped[int] = mapped_column(PrimaryKeyType, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        PrimaryKeyType,
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(String(32), default="baidu", nullable=False)
    app_id: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    encrypted_secret_key: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    user: Mapped["User"] = relationship(back_populates="translation_config")

    @property
    def is_configured(self) -> bool:
        """A configuration is usable only when both user-owned values exist."""
        return bool(self.app_id.strip() and self.encrypted_secret_key.strip())
