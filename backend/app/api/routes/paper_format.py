from __future__ import annotations

import json
import re
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import User
from app.services.ai_provider_manager import resolve_user_provider
from app.services.crypto import decrypt_api_key
from app.services.paper_format_ai import parse_format_requirements_with_ai
from app.services.paper_format_doc_converter import convert_legacy_doc_to_docx_bytes
from app.services.paper_format_normalizer import DEFAULT_PROFILE, PROFILES, normalize_paper_docx, serialize_profile
from app.services.paper_format_template import extract_template_requirements_from_docx

router = APIRouter(prefix="/paper-format", tags=["paper-format"])

DOCX_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
}
DOC_CONTENT_TYPES = {
    "application/msword",
}
MAX_DOCX_SIZE_BYTES = 30 * 1024 * 1024


class FormatRequirementParseRequest(BaseModel):
    text: str = Field(min_length=2, max_length=6000)
    provider_id: int | None = Field(default=None, ge=1)


@router.get("/profiles")
def list_format_profiles(
    _current_user: Annotated[User, Depends(get_current_user)],
):
    return {
        "default_profile": DEFAULT_PROFILE.key,
        "profiles": [
            {
                "key": profile.key,
                "title": profile.title,
                "body_font": profile.body_font,
                "latin_font": profile.latin_font,
                "heading_1_font": profile.heading_1_font,
                "heading_2_font": profile.heading_2_font,
                "heading_3_font": profile.heading_3_font,
                "body_size_pt": profile.body_size_pt,
                "heading_1_size_pt": profile.heading_1_size_pt,
                "heading_2_size_pt": profile.heading_2_size_pt,
                "heading_3_size_pt": profile.heading_3_size_pt,
                "table_size_pt": profile.table_size_pt,
                "line_spacing": profile.line_spacing,
                "first_line_indent_cm": profile.first_line_indent_cm,
                "heading_1_align": profile.heading_1_align,
                "heading_2_align": profile.heading_2_align,
                "heading_3_align": profile.heading_3_align,
                "body_align": profile.body_align,
                "add_page_number": profile.add_page_number,
                "chapter_page_break": profile.chapter_page_break,
                "requirements": serialize_profile(profile),
                "margins_cm": {
                    "top": profile.margin_top_cm,
                    "bottom": profile.margin_bottom_cm,
                    "left": profile.margin_left_cm,
                    "right": profile.margin_right_cm,
                },
            }
            for profile in PROFILES.values()
        ],
    }


@router.post("/parse-requirements")
def parse_format_requirements(
    payload: FormatRequirementParseRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    provider = resolve_user_provider(
        db,
        current_user.id,
        payload.provider_id,
        require_active=True,
        fallback_to_active=True,
    )
    if not provider:
        raise HTTPException(status_code=400, detail="请先在 AI 配置中启用一个可用模型。")
    try:
        api_key = decrypt_api_key(provider.encrypted_api_key)
        parsed = parse_format_requirements_with_ai(
            base_url=provider.base_url,
            api_key=api_key,
            model=provider.model,
            requirement_text=payload.text,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI 解析格式要求失败：{exc}") from exc
    return {
        **parsed,
        "model": provider.model,
        "provider_id": provider.id,
    }


@router.post("/normalize")
async def normalize_paper_format(
    _current_user: Annotated[User, Depends(get_current_user)],
    file: UploadFile = File(...),
    profile: str = Form(DEFAULT_PROFILE.key),
    requirements_json: str = Form("{}"),
):
    if not file.filename or not file.filename.lower().endswith(".docx"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请上传 .docx 格式的 Word 论文文档。")
    if file.content_type and file.content_type not in DOCX_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件类型不是有效的 Word 文档。")

    content = await file.read()
    await file.close()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文档内容为空。")
    if len(content) > MAX_DOCX_SIZE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Word 文档不能超过 30MB。")

    try:
        requirements = json.loads(requirements_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="格式要求不是有效的 JSON。") from exc
    if not isinstance(requirements, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="格式要求必须是一个对象。")

    try:
        output, stats = normalize_paper_docx(content, profile, requirements)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"论文格式规范化失败：{exc}") from exc

    filename = _normalized_filename(file.filename)
    return Response(
        output,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{_ascii_filename(filename)}"; '
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "X-Format-Stats": json.dumps(stats, ensure_ascii=True),
        },
    )


@router.post("/extract-template")
async def extract_paper_format_template(
    _current_user: Annotated[User, Depends(get_current_user)],
    file: UploadFile = File(...),
):
    suffix = (file.filename or "").lower()
    if not suffix.endswith((".docx", ".doc")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请上传 .docx 或 .doc 格式的模板文档。")
    if file.content_type and file.content_type not in DOCX_CONTENT_TYPES | DOC_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="模板文件类型不是有效的 Word 文档。")

    content = await file.read()
    await file.close()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="模板文档内容为空。")
    if len(content) > MAX_DOCX_SIZE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="模板文档不能超过 30MB。")

    try:
        normalized_content = (
            convert_legacy_doc_to_docx_bytes(content, file.filename or "template.doc")
            if suffix.endswith(".doc") and not suffix.endswith(".docx")
            else content
        )
        extracted = extract_template_requirements_from_docx(normalized_content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"模板规则提取失败：{exc}") from exc

    return {
        **extracted,
        "file_name": file.filename,
    }


def _normalized_filename(filename: str) -> str:
    base = re.sub(r"\.docx$", "", filename, flags=re.IGNORECASE)
    base = re.sub(r'[\\/:*?"<>|]+', " ", base)
    base = re.sub(r"\s+", " ", base).strip() or "paper"
    return f"{base[:90]}-格式规范化.docx"


def _ascii_filename(filename: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._ -]+", "_", filename).strip(" .")
    return value[:120] or "normalized-paper.docx"
