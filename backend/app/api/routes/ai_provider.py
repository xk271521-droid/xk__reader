from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import User
from app.models.ai_provider import AiProvider
from app.schemas.ai_provider import (
    AiProviderCreate,
    AiProviderListResponse,
    AiProviderResponse,
    AiProviderTestRequest,
    AiProviderTestResponse,
    AiProviderUpdate,
)
from app.services.crypto import decrypt_api_key, encrypt_api_key
from app.services.ai_provider_manager import (
    activate_user_provider,
    ensure_active_provider_after_delete,
    get_next_user_provider_sort_order,
    is_builtin_provider,
    is_translation_only_provider,
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


def _resolve_provider_test_values(
    payload: AiProviderTestRequest,
    user: User,
    db: Session,
) -> tuple[str, str, str] | None:
    """Use transient form input, falling back only to this user's saved key."""
    saved = None
    if payload.provider_id is not None:
        saved = db.scalar(
            select(AiProvider).where(
                AiProvider.id == payload.provider_id,
                AiProvider.user_id == user.id,
            )
        )
        if not saved:
            return None

    base_url = (payload.base_url or (saved.base_url if saved else "")).strip().rstrip("/")
    model = (payload.model or (saved.model if saved else "")).strip()
    api_key = (payload.api_key or "").strip()
    if not api_key and saved:
        try:
            api_key = decrypt_api_key(saved.encrypted_api_key).strip()
        except Exception:
            api_key = ""
    if not base_url or not model or not api_key:
        return None
    if not base_url.startswith(("https://", "http://")):
        return None
    return base_url, api_key, model


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


@router.post("/providers/test", response_model=AiProviderTestResponse)
def test_provider_connection(
    payload: AiProviderTestRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AiProviderTestResponse:
    """Send one minimal OpenAI-compatible request without saving form input."""
    values = _resolve_provider_test_values(payload, user, db)
    if not values:
        return AiProviderTestResponse(
            success=False,
            message="请填写完整的 Base URL、模型名称和 API Key。",
        )

    base_url, api_key, model = values
    try:
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=15.0)
        client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Reply with OK."}],
            max_tokens=1,
            temperature=0,
        )
    except Exception:
        # Do not return provider internals or any part of the user's key.
        return AiProviderTestResponse(
            success=False,
            message="连接失败，请检查 Base URL、模型名称、API Key 和账户额度。",
        )
    return AiProviderTestResponse(success=True, message="连接成功，模型已正常响应。")


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
        # SiliconFlow is a translation-only credential. It must not replace
        # the global provider used by AI deep read and paper chat.
        is_active=(
            False
            if is_translation_only_provider(payload)
            else not any(item.is_active for item in existing_providers)
        ),
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

    if payload.is_active is True and is_translation_only_provider(provider):
        provider.is_active = False
    elif payload.is_active is True:
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
        # A provider may be converted to SiliconFlow while it was the global
        # provider. Keep that credential available for translation only.
        if is_translation_only_provider(provider):
            provider.is_active = False
            remaining_providers = db.scalars(
                select(AiProvider).where(
                    AiProvider.user_id == user.id,
                    AiProvider.id != provider.id,
                )
            ).all()
            ensure_active_provider_after_delete(db, user.id, remaining_providers)
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
