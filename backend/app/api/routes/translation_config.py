from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.models.user_translation_config import UserTranslationConfig
from app.schemas.translation_config import (
    BaiduTranslationTestRequest,
    BaiduTranslationTestResponse,
    TranslationConfigResponse,
    TranslationConfigUpdate,
)
from app.services.crypto import decrypt_api_key, encrypt_api_key
from app.services.translate import call_baidu_translate_api

router = APIRouter()


def _to_response(config: UserTranslationConfig | None) -> TranslationConfigResponse:
    return TranslationConfigResponse(
        provider="baidu",
        app_id=config.app_id if config else "",
        has_secret_key=bool(config and config.encrypted_secret_key),
        is_configured=bool(config and config.is_configured),
        updated_at=config.updated_at.isoformat() if config and config.updated_at else None,
    )


@router.get("/translation/config", response_model=TranslationConfigResponse)
def get_user_translation_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TranslationConfigResponse:
    """获取当前用户的翻译配置（密码不返回明文，仅返回是否已配置）"""
    config = (
        db.query(UserTranslationConfig)
        .filter(UserTranslationConfig.user_id == current_user.id)
        .first()
    )
    return _to_response(config)


@router.post("/translation/config", response_model=TranslationConfigResponse)
def save_user_translation_config(
    payload: TranslationConfigUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TranslationConfigResponse:
    """保存或更新当前用户的百度翻译配置"""
    app_id = payload.app_id.strip()
    secret_key = (payload.secret_key or "").strip()

    if not app_id:
        raise HTTPException(status_code=400, detail="APP ID 不能为空")

    config = (
        db.query(UserTranslationConfig)
        .filter(UserTranslationConfig.user_id == current_user.id)
        .first()
    )
    if not config:
        if not secret_key:
            raise HTTPException(status_code=400, detail="首次保存需要填写密钥")
        config = UserTranslationConfig(user_id=current_user.id)
        db.add(config)

    config.app_id = app_id
    if secret_key:
        config.encrypted_secret_key = encrypt_api_key(secret_key)
    db.commit()
    db.refresh(config)

    return _to_response(config)


@router.delete("/translation/config", response_model=TranslationConfigResponse)
def delete_user_translation_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """清空当前用户的百度翻译配置，恢复为未配置状态"""
    config = (
        db.query(UserTranslationConfig)
        .filter(UserTranslationConfig.user_id == current_user.id)
        .first()
    )
    if config:
        config.app_id = ""
        config.encrypted_secret_key = ""
        db.commit()
    return _to_response(config)


@router.post("/translation/baidu/test", response_model=BaiduTranslationTestResponse)
def test_baidu_translation(
    payload: BaiduTranslationTestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BaiduTranslationTestResponse:
    """测试百度翻译 API 连通性。如果 payload 未传入 key，则使用当前用户已保存的配置。"""
    test_text = payload.text.strip() or "Hello"
    app_id = payload.app_id.strip() if payload.app_id else ""
    secret_key = payload.secret_key.strip() if payload.secret_key else ""

    if not app_id or not secret_key:
        config = (
            db.query(UserTranslationConfig)
            .filter(UserTranslationConfig.user_id == current_user.id)
            .first()
        )
        if config and config.is_configured:
            app_id = app_id or config.app_id or ""
            if not secret_key and config.encrypted_secret_key:
                try:
                    secret_key = decrypt_api_key(config.encrypted_secret_key)
                except Exception:
                    pass

    if not app_id or not secret_key:
        return BaiduTranslationTestResponse(
            success=False,
            result="",
            error_message="缺少 APP ID 或密钥，请填写后重试",
        )

    dst, err_msg = call_baidu_translate_api(
        text=test_text,
        appid=app_id,
        secret=secret_key,
        timeout=10,
    )

    if err_msg:
        return BaiduTranslationTestResponse(
            success=False,
            result="",
            error_message=err_msg,
        )

    return BaiduTranslationTestResponse(
        success=True,
        result=dst or "",
        error_message=None,
    )
