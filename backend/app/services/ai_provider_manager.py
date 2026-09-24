from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import AiProvider
from app.services.crypto import decrypt_api_key, encrypt_api_key
from app.services.translation_models import is_siliconflow_endpoint

LEGACY_BUILTIN_MODELS = {
    ("https://open.bigmodel.cn/api/paas/v4", "glm-4.7-flash"): frozenset({"glm-4-flash"}),
    ("https://api.deepseek.com", "deepseek-v4-flash"): frozenset({"deepseek-chat"}),
}
LEGACY_BUILTIN_LABELS = frozenset({
    "智谱 GLM-4-Flash (官方)",
    "智谱 GLM-4.7 Flash (官方)",
    "DeepSeek V3 (官方)",
    "DeepSeek V4 Flash (官方)",
})


def get_default_provider_blueprints() -> list[dict[str, str | int]]:
    return [
        {
            "label": str(provider["label"]),
            "base_url": str(provider["base_url"]),
            "api_key": str(provider["api_key"]),
            "model": str(provider["model"]),
            "sort_order": int(provider.get("sort_order", index)),
        }
        for index, provider in enumerate(settings.system_providers)
        if str(provider.get("api_key", "")).strip()
    ]


def _provider_signature(*, base_url: str, model: str) -> tuple[str, str]:
    return base_url.strip(), model.strip()


def _blueprint_signature(blueprint: dict[str, str | int]) -> tuple[str, str]:
    return _provider_signature(
        base_url=str(blueprint["base_url"]),
        model=str(blueprint["model"]),
    )


def find_builtin_provider_for_blueprint(
    providers: Iterable[AiProvider],
    blueprint: dict[str, str | int],
) -> AiProvider | None:
    """Match the current blueprint or a known legacy built-in in place."""
    provider_list = list(providers)
    signature = _blueprint_signature(blueprint)
    for provider in provider_list:
        if _provider_signature(base_url=provider.base_url, model=provider.model) == signature:
            return provider

    legacy_models = LEGACY_BUILTIN_MODELS.get(signature, frozenset())
    if not legacy_models:
        return None
    for provider in provider_list:
        if provider.base_url.strip() != signature[0]:
            continue
        if provider.model.strip() not in legacy_models:
            continue
        # User-created providers on the same API endpoint must not be rewritten.
        if provider.user_id is not None and provider.label not in LEGACY_BUILTIN_LABELS:
            continue
        return provider
    return None


def is_builtin_provider(provider: AiProvider) -> bool:
    signature = _provider_signature(base_url=provider.base_url, model=provider.model)
    return any(_blueprint_signature(blueprint) == signature for blueprint in get_default_provider_blueprints())


def is_translation_only_provider(provider: AiProvider | None) -> bool:
    """SiliconFlow cards belong to translation lanes, not the chat lane."""
    return bool(provider and is_siliconflow_endpoint(provider.base_url))


def list_user_providers(db: Session, user_id: int) -> list[AiProvider]:
    ensure_user_default_providers(db, user_id, commit=True)
    return db.scalars(
        select(AiProvider)
        .where(AiProvider.user_id == user_id)
        .order_by(AiProvider.sort_order, AiProvider.id)
    ).all()


def get_next_user_provider_sort_order(db: Session, user_id: int) -> int:
    providers = list_user_providers(db, user_id)
    if not providers:
        return 0
    return max(int(provider.sort_order or 0) for provider in providers) + 1


def ensure_user_default_providers(db: Session, user_id: int, *, commit: bool = False) -> list[AiProvider]:
    providers = db.scalars(
        select(AiProvider)
        .where(AiProvider.user_id == user_id)
        .order_by(AiProvider.sort_order, AiProvider.id)
    ).all()
    blueprints = get_default_provider_blueprints()
    changed = False
    # Older builds treated SiliconFlow as a global provider. Normalize those
    # records so enabling a translation credential cannot redirect chat/AI read.
    for provider in providers:
        if is_translation_only_provider(provider) and provider.is_active:
            provider.is_active = False
            db.add(provider)
            changed = True

    has_active_provider = any(
        provider.is_active and not is_translation_only_provider(provider)
        for provider in providers
    )

    for index, blueprint in enumerate(blueprints):
        signature = _blueprint_signature(blueprint)
        provider = find_builtin_provider_for_blueprint(providers, blueprint)
        if provider:
            next_label = str(blueprint["label"])
            next_sort_order = int(blueprint["sort_order"])
            next_api_key = str(blueprint["api_key"])
            next_model = str(blueprint["model"])
            if provider.model != next_model:
                provider.model = next_model
                db.add(provider)
                changed = True
            if provider.label != next_label:
                provider.label = next_label
                db.add(provider)
                changed = True
            if int(provider.sort_order or 0) != next_sort_order:
                provider.sort_order = next_sort_order
                db.add(provider)
                changed = True
            current_api_key = ""
            try:
                current_api_key = decrypt_api_key(provider.encrypted_api_key)
            except Exception:
                current_api_key = ""
            if current_api_key != next_api_key:
                provider.encrypted_api_key = encrypt_api_key(next_api_key)
                db.add(provider)
                changed = True
            continue

        provider = AiProvider(
            user_id=user_id,
            label=str(blueprint["label"]),
            base_url=str(blueprint["base_url"]),
            encrypted_api_key=encrypt_api_key(str(blueprint["api_key"])),
            model=str(blueprint["model"]),
            is_active=not has_active_provider and index == 0,
            sort_order=int(blueprint["sort_order"]),
        )
        db.add(provider)
        providers.append(provider)
        changed = True

    if providers and not any(
        provider.is_active and not is_translation_only_provider(provider)
        for provider in providers
    ):
        chat_providers = [
            provider for provider in providers
            if not is_translation_only_provider(provider)
        ]
        if chat_providers:
            first_provider = min(
                chat_providers,
                key=lambda provider: (int(provider.sort_order or 0), int(provider.id or 0)),
            )
            first_provider.is_active = True
            db.add(first_provider)
            changed = True

    if changed:
        if commit:
            db.commit()
            providers = db.scalars(
                select(AiProvider)
                .where(AiProvider.user_id == user_id)
                .order_by(AiProvider.sort_order, AiProvider.id)
            ).all()
        else:
            db.flush()

    return providers


def resolve_user_provider(
    db: Session,
    user_id: int,
    provider_id: int | None = None,
    *,
    require_active: bool = True,
    fallback_to_active: bool = True,
) -> AiProvider | None:
    ensure_user_default_providers(db, user_id, commit=True)

    if provider_id:
        conditions = [
            AiProvider.id == provider_id,
            AiProvider.user_id == user_id,
            # SiliconFlow credentials are reserved for translation lanes.
            # Even an explicitly supplied id must never route chat, reading,
            # outline, or other non-translation AI work to that card.
            ~AiProvider.base_url.ilike("%siliconflow%"),
        ]
        if require_active:
            conditions.append(AiProvider.is_active.is_(True))
        provider = db.scalar(select(AiProvider).where(*conditions))
        if provider:
            return provider

    if not fallback_to_active:
        return None

    fallback_conditions = [
        AiProvider.user_id == user_id,
        ~AiProvider.base_url.ilike("%siliconflow%"),
    ]
    if require_active:
        fallback_conditions.append(AiProvider.is_active.is_(True))

    provider = db.scalar(
        select(AiProvider)
        .where(*fallback_conditions)
        .order_by(AiProvider.sort_order, AiProvider.id)
        .limit(1)
    )
    if provider or require_active:
        return provider

    return db.scalar(
        select(AiProvider)
        .where(
            AiProvider.user_id == user_id,
            ~AiProvider.base_url.ilike("%siliconflow%"),
        )
        .order_by(AiProvider.sort_order, AiProvider.id)
        .limit(1)
    )


def resolve_siliconflow_provider(
    db: Session,
    user_id: int,
    provider_id: int | None = None,
) -> AiProvider | None:
    """Find a user's SiliconFlow credential without changing global AI state.

    Full-paper translation and the optional SiliconFlow selection models are a
    dedicated translation lane. They therefore use the configured SiliconFlow
    credential even when another provider is active for chat. ``is_active`` is
    still preferred when several SiliconFlow cards exist, but it is not
    required for this dedicated lane.
    """
    providers = list_user_providers(db, user_id)
    siliconflow = [
        provider
        for provider in providers
        if is_siliconflow_endpoint(provider.base_url)
    ]
    if provider_id is not None:
        return next(
            (provider for provider in siliconflow if provider.id == provider_id),
            None,
        )
    active = next((provider for provider in siliconflow if provider.is_active), None)
    return active or (siliconflow[0] if siliconflow else None)


def activate_user_provider(db: Session, user_id: int, provider_id: int) -> AiProvider | None:
    provider = db.scalar(
        select(AiProvider).where(
            AiProvider.id == provider_id,
            AiProvider.user_id == user_id,
        )
    )
    if not provider:
        return None

    db.execute(
        update(AiProvider)
        .where(
            AiProvider.user_id == user_id,
            AiProvider.id != provider_id,
        )
        .values(is_active=False)
    )
    provider.is_active = True
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider


def ensure_active_provider_after_delete(
    db: Session,
    user_id: int,
    remaining_providers: Iterable[AiProvider],
) -> None:
    providers = list(remaining_providers)
    if not providers or any(provider.is_active for provider in providers):
        return

    chat_providers = [
        provider for provider in providers
        if not is_translation_only_provider(provider)
    ]
    if not chat_providers:
        return
    next_provider = min(
        chat_providers,
        key=lambda provider: (int(provider.sort_order or 0), int(provider.id or 0)),
    )
    next_provider.is_active = True
    db.add(next_provider)
