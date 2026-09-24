"""Shared translation model identifiers and provider selection rules.

The model order is deliberately kept in one place so full-paper translation
and selection translation cannot silently drift apart.
"""

from __future__ import annotations

from dataclasses import dataclass


SILICONFLOW_DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1"


@dataclass(frozen=True)
class TranslationModel:
    key: str
    model_id: str
    label: str


# The order is a product decision based on the user's academic-terminology
# tests: GLM-4 first, Qwen3 second, GLM-Z1 third, Hunyuan last.
FULL_TRANSLATION_MODELS: tuple[TranslationModel, ...] = (
    TranslationModel("siliconflow_glm4", "THUDM/GLM-4-9B-0414", "GLM-4-9B-0414"),
    TranslationModel("siliconflow_qwen3", "Qwen/Qwen3-8B", "Qwen3-8B"),
    TranslationModel("siliconflow_glmz1", "THUDM/GLM-Z1-9B-0414", "GLM-Z1-9B-0414"),
    TranslationModel("siliconflow_hunyuan", "tencent/Hunyuan-MT-7B", "Hunyuan-MT-7B"),
)

FULL_TRANSLATION_MODEL_BY_KEY = {
    model.key: model for model in FULL_TRANSLATION_MODELS
}
FULL_TRANSLATION_MODEL_BY_ID = {
    model.model_id: model for model in FULL_TRANSLATION_MODELS
}


def is_siliconflow_endpoint(base_url: str | None) -> bool:
    """Recognize SiliconFlow and its common API-compatible URL variants."""
    value = (base_url or "").strip().lower()
    return "siliconflow.cn" in value or "siliconflow.com" in value


def candidate_models_for_provider(
    *,
    base_url: str,
    configured_model: str,
) -> tuple[TranslationModel, ...]:
    """Return the model chain for a provider snapshot.

    A SiliconFlow provider gets the four dedicated translation models. For
    existing non-SiliconFlow providers, keep the configured model as a
    single candidate so old DeepSeek/GLM jobs remain compatible.
    """
    if is_siliconflow_endpoint(base_url):
        return FULL_TRANSLATION_MODELS
    configured = (configured_model or "").strip()
    if configured in FULL_TRANSLATION_MODEL_BY_ID:
        return (FULL_TRANSLATION_MODEL_BY_ID[configured],)
    return (TranslationModel("configured", configured, configured),) if configured else ()


def model_for_selection_provider(provider_key: str | None) -> TranslationModel | None:
    return FULL_TRANSLATION_MODEL_BY_KEY.get((provider_key or "").strip())


def model_labels() -> list[dict[str, str]]:
    """Serialize the stable choices for API/UI documentation or tests."""
    return [
        {"key": model.key, "model": model.model_id, "label": model.label}
        for model in FULL_TRANSLATION_MODELS
    ]
