from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Paper, User
from app.models.user_translation_config import UserTranslationConfig
from app.schemas.selection import (
    AskRequest,
    AskResponse,
    SelectionInsightRequest,
    SelectionInsightResponse,
    SuggestQuestionGroup,
    SuggestQuestionsRequest,
    SuggestQuestionsResponse,
)
from app.services.ai_provider_manager import (
    resolve_siliconflow_provider,
    resolve_user_provider,
)
from app.services.crypto import decrypt_api_key
from app.services.paper_context import extract_paper_full_text
from app.services.selection_insight import (
    TranslationProviderUnavailable,
    build_selection_insight,
)
from app.services.translation_models import is_siliconflow_endpoint

router = APIRouter()


def _load_owned_paper_context(
    db: Session,
    user_id: int,
    paper_id: int,
) -> tuple[Paper, str]:
    paper = db.scalar(
        select(Paper).where(
            Paper.id == paper_id,
            Paper.user_id == user_id,
            Paper.deleted_at.is_(None),
        )
    )
    if not paper:
        raise HTTPException(status_code=404, detail="论文不存在。")

    full_text = extract_paper_full_text(paper.file_path)
    if not full_text:
        raise HTTPException(status_code=422, detail="未能从这篇论文中提取全文文字，暂时无法进行全文问答。")
    return paper, full_text


def _trim_text(value: str | None, limit: int = 120) -> str:
    text = " ".join((value or "").split()).strip()
    if not text:
        return ""
    return text if len(text) <= limit else f"{text[:limit].rstrip()}..."


def _paper_subject(payload: SuggestQuestionsRequest) -> str:
    if payload.selected_text.strip():
        return _trim_text(payload.selected_text, 80)
    if payload.paper_title:
        return _trim_text(payload.paper_title, 48)
    return "这篇论文"


def _fallback_initial_questions(payload: SuggestQuestionsRequest) -> list[str]:
    subject = _paper_subject(payload) or "这篇论文"
    title = _trim_text(payload.paper_title, 30) or "这篇论文"

    return [
        f"{title} 的核心创新点到底是什么？",
        f"作者是怎么用 {subject} 解决问题的？",
        f"这篇论文的实验结果最值得关注哪几点？",
    ]


def _fallback_followup_groups(payload: SuggestQuestionsRequest) -> list[SuggestQuestionGroup]:
    subject = _paper_subject(payload) or "这篇论文"
    last_question = _trim_text(payload.last_user_question, 60) or "刚才那个问题"
    answer_focus = _trim_text(payload.last_assistant_answer, 90) or _trim_text(payload.summary, 90) or "当前回答"

    return [
        SuggestQuestionGroup(
            title="深入理解",
            rationale=f"围绕 {subject} 继续拆方法逻辑，帮助把刚才的解释真正吃透。",
            questions=[
                f"{subject} 在整篇论文里具体承担什么角色？",
                f"作者为什么会这样设计 {subject}？",
                f"如果只保留最关键一步，{subject} 的核心逻辑是什么？",
            ],
        ),
        SuggestQuestionGroup(
            title="结果追问",
            rationale=f"顺着刚才关于“{answer_focus}”的回答，继续追实验结果、对比和局限。",
            questions=[
                f"{last_question} 对应的实验结果是怎么证明的？",
                "这篇论文和已有方法相比，提升最明显的是哪一项？",
                "作者有没有提到这个方法的局限或失败场景？",
            ],
        ),
        SuggestQuestionGroup(
            title="迁移应用",
            rationale=f"把 {subject} 从论文结论延伸到应用和扩展，更适合继续阅读时发散提问。",
            questions=[
                f"{subject} 能迁移到别的任务或数据集上吗？",
                "如果我想复现这篇论文，最先应该准备什么？",
                f"{subject} 对我现在在读的这一部分有什么启发？",
            ],
        ),
    ]


def _merge_questions(primary: list[str], fallback: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()

    for question in [*(primary or []), *(fallback or [])]:
        text = " ".join((question or "").split()).strip()
        if not text or text in seen:
            continue
        merged.append(text)
        seen.add(text)
        if len(merged) == 3:
            break

    return merged


def _merge_groups(
    primary: list[dict] | list[SuggestQuestionGroup],
    fallback: list[SuggestQuestionGroup],
) -> list[SuggestQuestionGroup]:
    normalized: list[SuggestQuestionGroup] = []

    for item in primary or []:
        if isinstance(item, SuggestQuestionGroup):
            normalized.append(item)
        elif isinstance(item, dict):
            try:
                normalized.append(SuggestQuestionGroup(**item))
            except Exception:
                continue
        if len(normalized) == 3:
            break

    if len(normalized) >= 3:
        return normalized[:3]

    for index, fallback_group in enumerate(fallback):
        if index < len(normalized):
            current = normalized[index]
            normalized[index] = SuggestQuestionGroup(
                title=current.title or fallback_group.title,
                rationale=current.rationale or fallback_group.rationale,
                questions=_merge_questions(current.questions, fallback_group.questions),
            )
        else:
            normalized.append(fallback_group)

        if len(normalized) == 3:
            break

    return normalized[:3]


def _build_recent_messages(payload: SuggestQuestionsRequest) -> list[dict[str, str]]:
    return [
        {"role": message.role, "text": message.text}
        for message in payload.recent_messages
        if message.text.strip()
    ]


def _load_provider_for_user(
    db: Session,
    user_id: int,
    provider_id: int | None,
):
    provider = resolve_user_provider(
        db,
        user_id,
        provider_id,
        require_active=True,
        fallback_to_active=True,
    )
    if not provider:
        return None, ""
    return provider, decrypt_api_key(provider.encrypted_api_key)


@router.post("/selection-insight", response_model=SelectionInsightResponse)
def selection_insight(
    payload: SelectionInsightRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SelectionInsightResponse:
    text = payload.text.strip()
    if len(text) < 2:
        raise HTTPException(status_code=400, detail="Selected text is too short.")

    # Basic selection translation must remain available independently of the
    # optional AI explanation quota. A UI rerender once repeated this request
    # enough times to exhaust the quota and made ordinary translation fail.
    try:
        provider_base_url = ""
        provider_api_key = ""
        if payload.translation_provider.startswith("siliconflow_"):
            provider = (
                resolve_siliconflow_provider(
                    db,
                    current_user.id,
                    payload.provider_id,
                )
                if payload.provider_id
                else resolve_siliconflow_provider(db, current_user.id)
            )
            if not provider or not is_siliconflow_endpoint(provider.base_url):
                raise TranslationProviderUnavailable(
                    "请先在 AI 厂商配置中配置 SiliconFlow 翻译厂商。"
                )
            try:
                provider_api_key = decrypt_api_key(provider.encrypted_api_key).strip()
            except Exception as exc:
                raise TranslationProviderUnavailable(
                    "SiliconFlow API 密钥无法读取，请重新保存配置。"
                ) from exc
            provider_base_url = provider.base_url.strip()
            if not provider_api_key:
                raise TranslationProviderUnavailable("SiliconFlow API 密钥未配置。")
        baidu_appid = ""
        baidu_secret = ""
        if payload.translation_provider == "baidu":
            tr_config = (
                db.query(UserTranslationConfig)
                .filter(UserTranslationConfig.user_id == current_user.id)
                .first()
            )
            if tr_config and tr_config.is_configured:
                baidu_appid = tr_config.app_id or ""
                if tr_config.encrypted_secret_key:
                    try:
                        baidu_secret = decrypt_api_key(tr_config.encrypted_secret_key).strip()
                    except Exception:
                        pass
        return build_selection_insight(
            text=text,
            paper_title=payload.paper_title,
            domain=payload.domain,
            translation_provider=payload.translation_provider,
            summary=payload.summary,
            context=payload.context or "",
            provider_id=payload.provider_id,
            provider_base_url=provider_base_url,
            provider_api_key=provider_api_key,
            baidu_appid=baidu_appid,
            baidu_secret=baidu_secret,
        )
    except TranslationProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/ask", response_model=AskResponse)
def ask_question(
    payload: AskRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    question = payload.question.strip()
    if len(question) < 2:
        raise HTTPException(status_code=400, detail="Question too short.")

    paper, full_text = _load_owned_paper_context(
        db,
        current_user.id,
        payload.paper_id,
    )
    try:
        from app.services.llm import ask_question as llm_ask

        provider, api_key = _load_provider_for_user(db, current_user.id, getattr(payload, "provider_id", None))
        if not provider or not api_key:
            return {"answer": "没有可用的 AI 厂商，请先在 AI 配置中启用一个。"}

        answer = llm_ask(
            base_url=provider.base_url,
            api_key=api_key,
            model=provider.model,
            question=question,
            selected_text=getattr(payload, "selected_text", "") or "",
            paper_title=paper.title or paper.file_name,
            full_text=full_text,
            request_kind=payload.request_kind,
        )
        return {"answer": answer}
    except Exception as exc:
        return {"answer": f"AI 回答失败：{str(exc)[:100]}"}


@router.post("/ask-stream")
def ask_question_stream(
    payload: AskRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    question = payload.question.strip()
    if len(question) < 2:
        raise HTTPException(status_code=400, detail="Question too short.")

    paper, full_text = _load_owned_paper_context(
        db,
        current_user.id,
        payload.paper_id,
    )
    provider, api_key = _load_provider_for_user(db, current_user.id, getattr(payload, "provider_id", None))
    if not provider or not api_key:
        return StreamingResponse(
            iter([f"data: {json.dumps('没有可用的 AI 厂商，请先在 AI 配置中启用一个。', ensure_ascii=False)}\n\n"]),
            media_type="text/event-stream",
        )

    def generate():
        try:
            from app.services.llm import ask_question_stream as llm_ask_stream

            for token in llm_ask_stream(
                base_url=provider.base_url,
                api_key=api_key,
                model=provider.model,
                question=question,
                selected_text=getattr(payload, "selected_text", "") or "",
                paper_title=paper.title or paper.file_name,
                full_text=full_text,
                request_kind=payload.request_kind,
            ):
                yield f"data: {json.dumps(token, ensure_ascii=False)}\n\n"
        except Exception as exc:
            message = f"AI 回答失败：{str(exc)[:100]}"
            yield f"data: {json.dumps(message, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/suggest-questions", response_model=SuggestQuestionsResponse)
def suggest_questions(
    payload: SuggestQuestionsRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> SuggestQuestionsResponse:
    fallback_questions = _fallback_initial_questions(payload)
    fallback_groups = _fallback_followup_groups(payload)

    try:
        provider, api_key = _load_provider_for_user(db, current_user.id, payload.provider_id)
        if provider and api_key:
            from app.services.llm import (
                suggest_followup_groups as llm_suggest_followup_groups,
                suggest_initial_questions as llm_suggest_initial_questions,
            )

            if payload.mode == "initial":
                questions = llm_suggest_initial_questions(
                    base_url=provider.base_url,
                    api_key=api_key,
                    model=provider.model,
                    paper_title=payload.paper_title or "",
                    summary=payload.summary or "",
                    selected_text=payload.selected_text or "",
                )
                return SuggestQuestionsResponse(
                    questions=_merge_questions(questions, fallback_questions),
                    source=f"llm:{provider.label}",
                )

            groups = llm_suggest_followup_groups(
                base_url=provider.base_url,
                api_key=api_key,
                model=provider.model,
                paper_title=payload.paper_title or "",
                summary=payload.summary or "",
                selected_text=payload.selected_text or "",
                last_user_question=payload.last_user_question or "",
                last_assistant_answer=payload.last_assistant_answer or "",
                recent_messages=_build_recent_messages(payload),
            )
            return SuggestQuestionsResponse(
                groups=_merge_groups(groups, fallback_groups),
                source=f"llm:{provider.label}",
            )
    except Exception:
        pass

    if payload.mode == "initial":
        return SuggestQuestionsResponse(
            questions=fallback_questions,
            source="fallback:contextual",
        )

    return SuggestQuestionsResponse(
        groups=fallback_groups,
        source="fallback:contextual",
    )
