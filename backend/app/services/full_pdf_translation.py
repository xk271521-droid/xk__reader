"""Background task for one-time, layout-preserving full-PDF translations."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import AiProvider, Paper, PaperFullTranslation
from app.services.crypto import decrypt_api_key
from app.services.ai_provider_manager import resolve_siliconflow_provider, resolve_user_provider
from app.services.notification import compact_notification_text, create_notification
from app.services.oss_storage import (
    delete_object as delete_oss_object,
    full_translation_object_key,
    upload_file as upload_oss_file,
)
from app.services.pdfmathtranslate import (
    PdfMathTranslateError,
    PdfMathTranslateProvider,
    resolve_paper_source,
    run_pdfmathtranslate,
    sha256_file,
    translation_artifact_destination,
    translation_artifact_file,
    translation_artifact_relative_path,
    translation_job_dir,
)
from app.services.translation_models import candidate_models_for_provider
from app.services.upload_mirror import mirror_upload_file, remove_mirrored_upload


def delete_full_translation_artifact(artifact_path: str | None) -> None:
    if not artifact_path:
        return
    local_file = translation_artifact_file(artifact_path, restore_from_oss=False)
    if local_file:
        try:
            local_file.unlink()
        except OSError:
            pass
    remove_mirrored_upload(f"full-translations/{artifact_path}")
    delete_oss_object(full_translation_object_key(artifact_path))


def _notify(db, paper: Paper, *, event_kind: str, title: str, message: str) -> None:
    create_notification(
        db,
        user_id=paper.user_id,
        source_kind="full_translation",
        source_id=paper.id,
        event_kind=event_kind,
        title=title,
        message=message,
        action_kind="open-full-translation",
        action_payload={"paper_id": paper.id},
    )


def _load_translation_provider(
    db,
    *,
    paper: Paper,
    item: PaperFullTranslation,
) -> PdfMathTranslateProvider:
    """Load the user's active AI credential captured by the translation job."""
    provider: AiProvider | None = db.get(AiProvider, item.provider_id) if item.provider_id else None
    if not provider or provider.user_id != paper.user_id:
        # Older queued jobs may have no provider snapshot. Bind them to the
        # user's active card; never use a system-wide key in local mode.
        provider = resolve_user_provider(db, paper.user_id)
        # Keep queued jobs created by older builds compatible with an
        # explicitly configured SiliconFlow translation card.
        if not provider:
            provider = resolve_siliconflow_provider(db, paper.user_id)
        if provider:
            item.provider_id = provider.id
            summary = dict(item.parse_summary or {})
            summary.update(
                {
                    "provider_id": provider.id,
                    "provider_label": provider.label,
                    "provider_base_url": provider.base_url,
                    "provider_model": provider.model,
                    "provider_resolved_from_legacy_job": True,
                }
            )
            item.parse_summary = summary
            db.add(item)
            db.commit()

    if not provider or provider.user_id != paper.user_id:
        raise PdfMathTranslateError(
            "全文翻译需要先配置并启用一个 AI 厂商。"
        )
    try:
        api_key = decrypt_api_key(provider.encrypted_api_key).strip()
    except Exception as exc:
        raise PdfMathTranslateError("无法读取全文翻译 AI 密钥。") from exc
    if not api_key or not provider.base_url.strip() or not provider.model.strip():
        raise PdfMathTranslateError("全文翻译 AI 厂商配置不完整。")
    return PdfMathTranslateProvider(
        provider_id=provider.id,
        label=provider.label,
        base_url=provider.base_url,
        api_key=api_key,
        model=provider.model,
    )


def _load_translation_providers(
    db,
    *,
    paper: Paper,
    item: PaperFullTranslation,
) -> list[PdfMathTranslateProvider]:
    """Load one provider snapshot and expand supported translation fallbacks."""
    primary = _load_translation_provider(db, paper=paper, item=item)
    summary = dict(item.parse_summary or {})
    configured_models = summary.get("translation_models")
    if isinstance(configured_models, list):
        model_ids = [
            str(value).strip()
            for value in configured_models
            if str(value).strip()
        ]
    else:
        model_ids = []

    if not model_ids:
        model_ids = [
            model.model_id
            for model in candidate_models_for_provider(
                base_url=primary.base_url,
                configured_model=primary.model,
            )
        ]

    # Do not let stale metadata or a malformed task create an unbounded retry
    # loop. Unknown model IDs are still allowed for legacy custom providers.
    model_ids = list(dict.fromkeys(model_ids))[:4] or [primary.model]
    providers: list[PdfMathTranslateProvider] = []
    for model_id in model_ids:
        providers.append(
            PdfMathTranslateProvider(
                provider_id=primary.provider_id,
                label=primary.label,
                base_url=primary.base_url,
                api_key=primary.api_key,
                model=model_id,
            )
        )
    return providers


def _mark_failure(db, translation_id: int, error: Exception | str) -> None:
    item = db.get(PaperFullTranslation, translation_id)
    if not item or item.status == "cancelled":
        return
    paper = db.get(Paper, item.paper_id)
    previous = translation_artifact_file(item.artifact_path)
    reason = compact_notification_text(str(error), 420) or "译文 PDF 生成失败。"
    if previous:
        # A failed explicit retranslation must never take the user's usable
        # cached result away.  The next click is the only way to try again.
        item.status = "completed"
        item.error_message = f"本次重新翻译失败，已保留上一版译文：{reason}"
    else:
        item.status = "error"
        item.error_message = reason
    db.add(item)
    db.commit()
    if paper:
        _notify(
            db,
            paper,
            event_kind="failed",
            title="全文翻译失败",
            message=f"{compact_notification_text(paper.title or paper.file_name, 80)} · {reason}",
        )


def run_full_pdf_translation_task(translation_id: int) -> None:
    """Render one translated PDF and atomically replace the persisted artifact."""
    db = SessionLocal()
    job_dir: Path | None = None
    try:
        item = db.get(PaperFullTranslation, translation_id)
        if not item or item.status == "cancelled":
            return
        if not settings.full_translation_enabled:
            item.status = "cancelled"
            item.error_message = "全文翻译功能已暂停。"
            db.add(item)
            db.commit()
            return
        if not settings.pdfmathtranslate_available:
            raise PdfMathTranslateError("PDFMathTranslate 运行环境尚未配置。")

        paper = db.get(Paper, item.paper_id)
        if not paper or paper.deleted_at is not None:
            raise PdfMathTranslateError("关联论文不存在或已被删除。")
        source_pdf = resolve_paper_source(paper.file_path)
        if not source_pdf:
            raise PdfMathTranslateError("原始 PDF 文件已丢失，无法开始全文翻译。")
        providers = _load_translation_providers(db, paper=paper, item=item)
        provider = providers[0]

        item.status = "running"
        item.completed_units = 0
        item.total_units = 1
        item.error_message = None
        db.add(item)
        db.commit()

        job_dir = translation_job_dir(item.id)
        result = None
        attempts: list[dict[str, object]] = []
        for index, candidate in enumerate(providers):
            candidate_dir = job_dir / f"model-{index + 1}"
            try:
                result = run_pdfmathtranslate(
                    source_pdf,
                    job_dir=candidate_dir,
                    provider=candidate,
                )
                attempts.append({"model": candidate.model, "status": "completed"})
                break
            except Exception as exc:
                attempts.append(
                    {
                        "model": candidate.model,
                        "status": "failed",
                        "error": compact_notification_text(str(exc), 240),
                    }
                )
                if index == len(providers) - 1:
                    raise

        if result is None:
            raise PdfMathTranslateError("没有可用的全文翻译模型。")

        # Cancellation is cooperative: the external renderer is allowed to
        # finish, but its output is discarded instead of replacing a cache.
        item = db.get(PaperFullTranslation, translation_id)
        if not item or item.status == "cancelled":
            return

        version = max(1, int(item.generation_version or 0))
        artifact_path = translation_artifact_relative_path(item.paper_id, version)
        destination = translation_artifact_destination(artifact_path)
        temporary_destination = destination.with_suffix(".pdf.tmp")
        shutil.copy2(result.output_pdf, temporary_destination)
        if temporary_destination.stat().st_size <= 16:
            raise PdfMathTranslateError("生成的译文 PDF 文件为空。")
        os.replace(temporary_destination, destination)

        old_artifact_path = item.artifact_path
        # Local output is primary; mirrors are best-effort durability copies.
        mirror_upload_file(destination, f"full-translations/{artifact_path}")
        upload_oss_file(
            destination,
            full_translation_object_key(artifact_path),
            content_type="application/pdf",
        )

        item.source_hash = sha256_file(source_pdf)
        item.artifact_path = artifact_path
        item.artifact_sha256 = sha256_file(destination)
        item.artifact_size = destination.stat().st_size
        item.status = "completed"
        item.translation_engine = "pdfmathtranslate"
        item.parse_engine = "babeldoc"
        item.parse_summary = {
            **dict(result.summary),
            "translation_models": [candidate.model for candidate in providers],
            "model_attempts": attempts,
        }
        item.pages_json = []
        item.completed_units = 1
        item.total_units = 1
        item.error_message = None
        db.add(item)
        db.commit()

        # Only retire the old file after the new database record is durable.
        if old_artifact_path and old_artifact_path != artifact_path:
            delete_full_translation_artifact(old_artifact_path)
        _notify(
            db,
            paper,
            event_kind="completed",
            title="全文翻译已完成",
            message=compact_notification_text(paper.title or paper.file_name, 120),
        )
    except Exception as exc:
        db.rollback()
        _mark_failure(db, translation_id, exc)
    finally:
        if job_dir:
            shutil.rmtree(job_dir, ignore_errors=True)
        db.close()
