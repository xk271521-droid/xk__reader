from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.schemas.selection import (
    AskRequest,
    AskResponse,
    SelectionInsightExplainResponse,
    SelectionInsightRequest,
    SelectionInsightResponse,
)
from app.services.selection_insight import _ai_explanation_or_fallback  # type: ignore[reportPrivateUsage]
from app.services.selection_insight import build_selection_insight

router = APIRouter()


@router.post("/selection-insight", response_model=SelectionInsightResponse)
def selection_insight(payload: SelectionInsightRequest) -> SelectionInsightResponse:
    text = payload.text.strip()
    if len(text) < 2:
        raise HTTPException(status_code=400, detail="Selected text is too short.")

    return build_selection_insight(
        text=text,
        paper_title=payload.paper_title,
        domain=payload.domain,
        summary=payload.summary,
        context=payload.context or "",
        provider_id=payload.provider_id,
    )


@router.post("/selection-insight/explain", response_model=SelectionInsightExplainResponse)
def selection_insight_explain(payload: SelectionInsightRequest) -> SelectionInsightExplainResponse:
    text = payload.text.strip()
    if len(text) < 2:
        raise HTTPException(status_code=400, detail="Selected text is too short.")

    explanation = _ai_explanation_or_fallback(
        text=text,
        text_kind="",
        paper_title=payload.paper_title,
        glossary=[],
        summary=payload.summary,
        context=payload.context or "",
        provider_id=payload.provider_id,
    )
    return SelectionInsightExplainResponse(explanation=explanation)


@router.post("/selection-insight/explain-stream")
def selection_insight_explain_stream(payload: SelectionInsightRequest):
    text = payload.text.strip()
    if len(text) < 2:
        raise HTTPException(status_code=400, detail="Selected text is too short.")

    def generate():
        try:
            from app.db.session import SessionLocal
            from app.models.ai_provider import AiProvider
            from app.services.crypto import decrypt_api_key
            from app.services.llm import explain_selection_stream
            from sqlalchemy import select

            db = SessionLocal()
            try:
                provider = db.scalar(
                    select(AiProvider).where(
                        AiProvider.id == payload.provider_id,
                        AiProvider.is_active.is_(True),
                    )
                )
                if not provider:
                    yield "data: AI config unavailable\n\n"
                    return

                api_key = decrypt_api_key(provider.encrypted_api_key)
                for token in explain_selection_stream(
                    base_url=provider.base_url,
                    api_key=api_key,
                    model=provider.model,
                    selected_text=text,
                    summary=payload.summary or "",
                    context=payload.context or "",
                ):
                    yield f"data: {token}\n\n"
            finally:
                db.close()
        except Exception:
            yield "data: AI generation failed\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/ask", response_model=AskResponse)
def ask_question(payload: AskRequest):
    question = payload.question.strip()
    if len(question) < 2:
        raise HTTPException(status_code=400, detail="Question too short.")

    try:
        from app.db.session import SessionLocal
        from app.models.ai_provider import AiProvider
        from app.services.crypto import decrypt_api_key
        from app.services.llm import ask_question as llm_ask
        from sqlalchemy import select

        db = SessionLocal()
        try:
            provider_id = getattr(payload, "provider_id", None)
            provider = None
            if provider_id:
                provider = db.scalar(
                    select(AiProvider).where(
                        AiProvider.id == provider_id,
                        AiProvider.is_active.is_(True),
                    )
                )
            if not provider:
                provider = db.scalar(
                    select(AiProvider)
                    .where(AiProvider.is_active.is_(True))
                    .order_by(AiProvider.sort_order)
                    .limit(1)
                )
            if not provider:
                return {"answer": "没有可用的AI厂商，请先在AI配置中启用一个。"}

            api_key = decrypt_api_key(provider.encrypted_api_key)
            answer = llm_ask(
                base_url=provider.base_url,
                api_key=api_key,
                model=provider.model,
                question=question,
                selected_text=getattr(payload, "selected_text", "") or "",
                summary=getattr(payload, "summary", "") or "",
            )
            return {"answer": answer}
        finally:
            db.close()
    except Exception as exc:
        return {"answer": f"AI回答失败：{str(exc)[:100]}"}


@router.post("/ask-stream")
def ask_question_stream(payload: AskRequest):
    question = payload.question.strip()
    if len(question) < 2:
        raise HTTPException(status_code=400, detail="Question too short.")

    def generate():
        try:
            from app.db.session import SessionLocal
            from app.models.ai_provider import AiProvider
            from app.services.crypto import decrypt_api_key
            from app.services.llm import ask_question_stream as llm_ask_stream
            from sqlalchemy import select

            db = SessionLocal()
            try:
                provider_id = getattr(payload, "provider_id", None)
                provider = None
                if provider_id:
                    provider = db.scalar(
                        select(AiProvider).where(
                            AiProvider.id == provider_id,
                            AiProvider.is_active.is_(True),
                        )
                    )
                if not provider:
                    provider = db.scalar(
                        select(AiProvider)
                        .where(AiProvider.is_active.is_(True))
                        .order_by(AiProvider.sort_order)
                        .limit(1)
                    )
                if not provider:
                    yield "data: 没有可用的AI厂商，请先在AI配置中启用一个。\n\n"
                    return

                api_key = decrypt_api_key(provider.encrypted_api_key)
                for token in llm_ask_stream(
                    base_url=provider.base_url,
                    api_key=api_key,
                    model=provider.model,
                    question=question,
                    selected_text=getattr(payload, "selected_text", "") or "",
                    summary=getattr(payload, "summary", "") or "",
                ):
                    yield f"data: {token}\n\n"
            finally:
                db.close()
        except Exception as exc:
            yield f"data: AI回答失败：{str(exc)[:100]}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
