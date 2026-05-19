from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import User
from app.models.ai_provider import AiProvider
from app.schemas.ai_provider import (
    AiProviderCreate,
    AiProviderListResponse,
    AiProviderResponse,
    AiProviderUpdate,
    SummarizeRequest,
    SummarizeResponse,
)
from app.services.crypto import decrypt_api_key, encrypt_api_key
from app.services.llm import generate_summary
from app.services.ai_provider_manager import (
    activate_user_provider,
    ensure_active_provider_after_delete,
    get_next_user_provider_sort_order,
    is_builtin_provider,
    list_user_providers,
    resolve_user_provider,
)

router = APIRouter()


def _mask_key(key: str) -> str:
    if not key:
        return "(not configured)"
    if len(key) <= 8:
        return key[:2] + "****" + key[-2:]
    return key[:4] + "****" + key[-4:]


def _provider_to_response(provider: AiProvider, decrypted_key: str) -> AiProviderResponse:
    return AiProviderResponse(
        id=provider.id,
        label=provider.label,
        base_url=provider.base_url,
        api_key_masked=_mask_key(decrypted_key),
        model=provider.model,
        is_active=provider.is_active,
        is_system=is_builtin_provider(provider),
        sort_order=provider.sort_order,
    )


@router.get("/providers", response_model=AiProviderListResponse)
def list_providers(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AiProviderListResponse:
    providers = list_user_providers(db, user.id)
    result = []
    for p in providers:
        try:
            plain = decrypt_api_key(p.encrypted_api_key)
        except Exception:
            plain = "(解密失败)"
        result.append(_provider_to_response(p, plain))
    return AiProviderListResponse(providers=result)


@router.post("/providers", response_model=AiProviderResponse)
def create_provider(
    payload: AiProviderCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AiProviderResponse:
    existing_providers = list_user_providers(db, user.id)
    encrypted = encrypt_api_key(payload.api_key)
    provider = AiProvider(
        user_id=user.id,
        label=payload.label,
        base_url=payload.base_url,
        encrypted_api_key=encrypted,
        model=payload.model,
        is_active=not any(item.is_active for item in existing_providers),
        sort_order=get_next_user_provider_sort_order(db, user.id),
    )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return _provider_to_response(provider, payload.api_key)


@router.patch("/providers/{provider_id}", response_model=AiProviderResponse)
def update_provider(
    provider_id: int,
    payload: AiProviderUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AiProviderResponse:
    provider = db.scalar(
        select(AiProvider).where(
            AiProvider.id == provider_id,
            AiProvider.user_id == user.id,
        )
    )
    if not provider:
        raise HTTPException(status_code=404, detail="厂商不存在或无权修改")

    if payload.is_active is True:
        activated_provider = activate_user_provider(db, user.id, provider_id)
        if not activated_provider:
            raise HTTPException(status_code=404, detail="厂商不存在或无权修改")
        provider = activated_provider
    elif payload.is_active is not None:
        provider.is_active = False
        remaining_providers = db.scalars(
            select(AiProvider).where(AiProvider.user_id == user.id)
        ).all()
        ensure_active_provider_after_delete(db, user.id, remaining_providers)

    if is_builtin_provider(provider):
        if any(getattr(payload, f) is not None for f in ("label", "base_url", "api_key", "model")):
            raise HTTPException(status_code=403, detail="默认厂商只能切换启用状态")
    else:
        if payload.label is not None:
            provider.label = payload.label
        if payload.base_url is not None:
            provider.base_url = payload.base_url
        if payload.api_key is not None:
            provider.encrypted_api_key = encrypt_api_key(payload.api_key)
        if payload.model is not None:
            provider.model = payload.model
    db.commit()
    db.refresh(provider)
    plain = decrypt_api_key(provider.encrypted_api_key)
    return _provider_to_response(provider, plain)


@router.delete("/providers/{provider_id}")
def delete_provider(
    provider_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    provider = db.scalar(
        select(AiProvider).where(
            AiProvider.id == provider_id,
            AiProvider.user_id == user.id,
        )
    )
    if not provider:
        raise HTTPException(status_code=404, detail="厂商不存在或无权删除")
    if is_builtin_provider(provider):
        raise HTTPException(status_code=403, detail="默认厂商不支持删除")

    was_active = bool(provider.is_active)
    remaining_providers = db.scalars(
        select(AiProvider).where(
            AiProvider.user_id == user.id,
            AiProvider.id != provider.id,
        )
    ).all()
    db.delete(provider)
    db.flush()
    if was_active:
        ensure_active_provider_after_delete(db, user.id, remaining_providers)
    db.commit()
    return {"ok": True}


@router.post("/summarize", response_model=SummarizeResponse)
def summarize(
    payload: SummarizeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SummarizeResponse:
    provider = resolve_user_provider(
        db,
        user.id,
        payload.provider_id,
        require_active=True,
        fallback_to_active=False,
    )
    if not provider:
        raise HTTPException(status_code=404, detail="厂商不存在或已禁用")

    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    api_key = decrypt_api_key(provider.encrypted_api_key)
    text = payload.text[:40000]

    try:
        summary = generate_summary(
            base_url=provider.base_url,
            api_key=api_key,
            model=provider.model,
            full_text=text,
        )
        return SummarizeResponse(summary=summary)
    except Exception as exc:
        return SummarizeResponse(summary="")
