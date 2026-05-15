from __future__ import annotations

import base64
import hashlib
import hmac
import json
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib import error, parse, request

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import VerificationCode
from app.services.security import hash_verification_code


REGISTER_PURPOSE = "register"
RESET_PASSWORD_PURPOSE = "reset_password"
SMS_CHANNEL = "sms"
EMAIL_CHANNEL = "email"
TC3_CONTENT_TYPE = "application/json; charset=utf-8"
TC3_SERVICE = "sms"
TC3_ALGORITHM = "TC3-HMAC-SHA256"
ALIYUN_ALGORITHM = "ACS3-HMAC-SHA256"


def normalize_target(value: str) -> str:
    target = value.strip()
    return target.lower() if "@" in target else target


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def generate_numeric_code(length: int = 6) -> str:
    import secrets

    return "".join(secrets.choice("0123456789") for _ in range(length))


def _build_spug_url(template_url: str, *, target: str, code: str, channel: str) -> str:
    minute = str(max(1, settings.verification_code_ttl_seconds // 60))
    return (
        template_url
        .replace("{target}", parse.quote(target, safe=""))
        .replace("{code}", parse.quote(code, safe=""))
        .replace("{minute}", parse.quote(minute, safe=""))
        .replace("{channel}", parse.quote(channel, safe=""))
        .replace("{app}", parse.quote(settings.spug_push_app_name, safe=""))
    )


def _send_via_spug(template_url: str, *, target: str, code: str, channel: str, error_prefix: str) -> None:
    if not template_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{error_prefix}未配置。",
        )

    final_url = _build_spug_url(template_url, target=target, code=code, channel=channel)
    req = request.Request(final_url, method="GET")
    try:
        with request.urlopen(req, timeout=settings.spug_request_timeout_seconds) as response:
            body = response.read().decode("utf-8", errors="ignore")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"{error_prefix}发送失败：{detail or exc.reason}",
        ) from exc
    except error.URLError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"{error_prefix}服务不可用，请稍后重试。",
        ) from exc

    if body and any(token in body.lower() for token in ["error", "fail", "invalid"]):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"{error_prefix}发送失败：{body[:200]}",
        )


def send_email_code(email: str, code: str) -> None:
    errors: list[str] = []
    for provider in settings.email_provider_order:
        provider_name = provider.strip().lower()
        if provider_name == "spug":
            try:
                _send_via_spug(
                    settings.spug_email_template_url,
                    target=email,
                    code=code,
                    channel=EMAIL_CHANNEL,
                    error_prefix="Spug 邮箱验证码",
                )
                return
            except HTTPException as exc:
                errors.append(str(exc.detail))
        elif provider_name == "smtp":
            try:
                _send_email_via_smtp(email, code)
                return
            except HTTPException as exc:
                errors.append(str(exc.detail))

    if errors:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="；".join(errors),
        )

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="邮箱验证码服务未配置。",
    )


def _send_email_via_smtp(email: str, code: str) -> None:
    if not settings.smtp_available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SMTP 邮箱服务未配置。",
        )

    message = EmailMessage()
    message["Subject"] = "XK 阅读注册验证码"
    message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    message["To"] = email
    message.set_content(
        f"您的 XK 阅读注册验证码为：{code}\n"
        f"验证码 {max(1, settings.verification_code_ttl_seconds // 60)} 分钟内有效。"
    )

    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(
            settings.smtp_host,
            settings.smtp_port,
            context=ssl.create_default_context(),
            timeout=10,
        ) as server:
            server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(message)
        return

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
        server.starttls(context=ssl.create_default_context())
        server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(message)


def _send_sms_via_huyi(phone: str, code: str) -> None:
    if not settings.huyi_sms_available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="互亿无线短信未配置。",
        )

    content = settings.sms_code_template.format(code=code, minute=max(1, settings.verification_code_ttl_seconds // 60))
    payload = {
        "account": settings.huyi_sms_api_id,
        "password": settings.huyi_sms_api_key,
        "mobile": phone,
        "content": content,
        "format": "json",
    }
    body = parse.urlencode(payload).encode("utf-8")
    req = request.Request(settings.huyi_sms_endpoint, data=body, method="POST")
    try:
        with request.urlopen(req, timeout=10) as response:
            raw_body = response.read().decode("utf-8", errors="ignore")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"互亿无线短信发送失败：{detail or exc.reason}",
        ) from exc
    except error.URLError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="互亿无线短信服务不可用，请稍后重试。",
        ) from exc

    data = json.loads(raw_body)
    code_value = str(data.get("code", ""))
    if code_value != "2":
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"互亿无线短信发送失败：{data.get('msg') or '未知错误'}",
        )


def _send_sms_via_spug(phone: str, code: str) -> None:
    if not settings.spug_sms_available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Spug 短信未配置。",
        )
    _send_via_spug(
        settings.spug_sms_template_url,
        target=phone,
        code=code,
        channel=SMS_CHANNEL,
        error_prefix="Spug 短信验证码",
    )


def _sign_tc3_request(timestamp: int, body: str) -> str:
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
    canonical_headers = (
        f"content-type:{TC3_CONTENT_TYPE}\n"
        f"host:{settings.tencent_sms_endpoint}\n"
    )
    signed_headers = "content-type;host"
    hashed_body = hashlib.sha256(body.encode("utf-8")).hexdigest()
    canonical_request = "\n".join(
        [
            "POST",
            "/",
            "",
            canonical_headers,
            signed_headers,
            hashed_body,
        ]
    )
    credential_scope = f"{date}/{TC3_SERVICE}/tc3_request"
    string_to_sign = "\n".join(
        [
            TC3_ALGORITHM,
            str(timestamp),
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )

    secret_date = hmac.new(
        f"TC3{settings.tencent_secret_key}".encode("utf-8"),
        date.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    secret_service = hmac.new(secret_date, TC3_SERVICE.encode("utf-8"), hashlib.sha256).digest()
    secret_signing = hmac.new(secret_service, b"tc3_request", hashlib.sha256).digest()
    signature = hmac.new(
        secret_signing,
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return (
        f"{TC3_ALGORITHM} Credential={settings.tencent_secret_id}/{credential_scope}, "
        f"SignedHeaders=content-type;host, Signature={signature}"
    )


def _send_sms_via_tencent(phone: str, code: str) -> None:
    if not settings.tencent_sms_available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="腾讯云短信未配置。",
        )

    payload = {
        "PhoneNumberSet": [f"+86{phone}"],
        "SmsSdkAppId": settings.tencent_sms_sdk_app_id,
        "SignName": settings.tencent_sms_sign_name,
        "TemplateId": settings.tencent_sms_template_id,
        "TemplateParamSet": [code, str(max(1, settings.verification_code_ttl_seconds // 60))],
    }
    body = json.dumps(payload)
    timestamp = int(datetime.now(timezone.utc).timestamp())
    req = request.Request(
        url=f"https://{settings.tencent_sms_endpoint}",
        data=body.encode("utf-8"),
        method="POST",
        headers={
            "Authorization": _sign_tc3_request(timestamp, body),
            "Content-Type": TC3_CONTENT_TYPE,
            "Host": settings.tencent_sms_endpoint,
            "X-TC-Action": "SendSms",
            "X-TC-Version": "2021-01-11",
            "X-TC-Region": settings.tencent_sms_region,
            "X-TC-Timestamp": str(timestamp),
            "X-TC-Language": "zh-CN",
        },
    )

    try:
        with request.urlopen(req, timeout=10) as response:
            raw_body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"腾讯云短信发送失败：{detail or exc.reason}",
        ) from exc
    except error.URLError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="腾讯云短信服务不可用，请稍后重试。",
        ) from exc

    data = json.loads(raw_body)
    response_payload = data.get("Response", {})
    if response_payload.get("Error"):
        message = response_payload["Error"].get("Message") or "未知错误"
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"腾讯云短信发送失败：{message}",
        )

    send_status = (response_payload.get("SendStatusSet") or [{}])[0]
    if send_status.get("Code") not in {"Ok", "ok"}:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"腾讯云短信发送失败：{send_status.get('Message') or '未知错误'}",
        )


def _sign_aliyun_request(timestamp: str, nonce: str) -> str:
    canonical_headers = (
        f"host:{settings.aliyun_sms_endpoint}\n"
        "x-acs-action:SendSms\n"
        "x-acs-content-sha256:UNSIGNED-PAYLOAD\n"
        f"x-acs-date:{timestamp}\n"
        f"x-acs-signature-nonce:{nonce}\n"
        "x-acs-version:2017-05-25\n"
    )
    signed_headers = "host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version"
    canonical_request = "\n".join(
        [
            "POST",
            "/",
            "",
            canonical_headers,
            signed_headers,
            "UNSIGNED-PAYLOAD",
        ]
    )
    hashed_request = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    string_to_sign = "\n".join([ALIYUN_ALGORITHM, hashed_request])
    signature = base64.b64encode(
        hmac.new(
            settings.aliyun_sms_access_key_secret.encode("utf-8"),
            string_to_sign.encode("utf-8"),
            hashlib.sha256,
        ).digest()
    ).decode("utf-8")
    return (
        f"{ALIYUN_ALGORITHM} "
        f"Credential={settings.aliyun_sms_access_key_id},"
        f"SignedHeaders={signed_headers},"
        f"Signature={signature}"
    )


def _send_sms_via_aliyun(phone: str, code: str) -> None:
    if not settings.aliyun_sms_available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="阿里云短信未配置。",
        )

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    nonce = hashlib.md5(f"{phone}{timestamp}".encode("utf-8")).hexdigest()
    payload = {
        "PhoneNumbers": phone,
        "SignName": settings.aliyun_sms_sign_name,
        "TemplateCode": settings.aliyun_sms_template_code,
        "TemplateParam": json.dumps(
            {
                "code": code,
                "minute": str(max(1, settings.verification_code_ttl_seconds // 60)),
            },
            ensure_ascii=False,
        ),
    }
    body = parse.urlencode(payload).encode("utf-8")
    req = request.Request(
        url=f"https://{settings.aliyun_sms_endpoint}/",
        data=body,
        method="POST",
        headers={
            "Authorization": _sign_aliyun_request(timestamp, nonce),
            "Content-Type": "application/x-www-form-urlencoded",
            "Host": settings.aliyun_sms_endpoint,
            "x-acs-action": "SendSms",
            "x-acs-content-sha256": "UNSIGNED-PAYLOAD",
            "x-acs-date": timestamp,
            "x-acs-signature-nonce": nonce,
            "x-acs-version": "2017-05-25",
        },
    )

    try:
        with request.urlopen(req, timeout=10) as response:
            raw_body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"阿里云短信发送失败：{detail or exc.reason}",
        ) from exc
    except error.URLError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="阿里云短信服务不可用，请稍后重试。",
        ) from exc

    data = json.loads(raw_body)
    if data.get("Code") != "OK":
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"阿里云短信发送失败：{data.get('Message') or '未知错误'}",
        )


def send_sms_code(phone: str, code: str) -> None:
    errors: list[str] = []
    for provider in settings.sms_provider_order:
        provider_name = provider.strip().lower()
        try:
            if provider_name == "huyi":
                _send_sms_via_huyi(phone, code)
                return
            if provider_name == "spug":
                _send_sms_via_spug(phone, code)
                return
            if provider_name == "aliyun":
                _send_sms_via_aliyun(phone, code)
                return
            if provider_name == "tencent":
                _send_sms_via_tencent(phone, code)
                return
        except HTTPException as exc:
            errors.append(str(exc.detail))

    if errors:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="；".join(errors),
        )

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="短信验证码服务未配置。",
    )


def send_verification_code(channel: str, target: str, code: str) -> None:
    if channel == SMS_CHANNEL:
        send_sms_code(target, code)
        return
    if channel == EMAIL_CHANNEL:
        send_email_code(target, code)
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="不支持的验证码通道。",
    )


def issue_verification_code(
    db: Session,
    *,
    channel: str,
    purpose: str,
    target: str,
    request_ip: str,
) -> int:
    normalized_target = normalize_target(target)
    now = utc_now()
    latest = db.scalar(
        select(VerificationCode)
        .where(
            VerificationCode.channel == channel,
            VerificationCode.purpose == purpose,
            VerificationCode.target == normalized_target,
            VerificationCode.revoked_at.is_(None),
            VerificationCode.verified_at.is_(None),
        )
        .order_by(VerificationCode.created_at.desc(), VerificationCode.id.desc())
    )

    latest_expires_at = ensure_utc_datetime(latest.expires_at) if latest else None
    if latest_expires_at:
        latest_issued_at = latest_expires_at - timedelta(seconds=settings.verification_code_ttl_seconds)
        elapsed = (now - latest_issued_at).total_seconds()
        if elapsed < settings.verification_code_resend_cooldown_seconds:
            remaining = settings.verification_code_resend_cooldown_seconds - int(elapsed)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"发送过于频繁，请 {max(1, remaining)} 秒后重试。",
            )

    code = generate_numeric_code()
    record = VerificationCode(
        channel=channel,
        purpose=purpose,
        target=normalized_target,
        code_hash=hash_verification_code(channel, purpose, normalized_target, code),
        request_ip=request_ip,
        attempt_count=0,
        expires_at=now + timedelta(seconds=settings.verification_code_ttl_seconds),
    )
    db.add(record)
    db.commit()

    try:
        send_verification_code(channel, normalized_target, code)
    except Exception:
        record.revoked_at = utc_now()
        db.add(record)
        db.commit()
        raise

    return settings.verification_code_resend_cooldown_seconds


def verify_code(
    db: Session,
    *,
    channel: str,
    purpose: str,
    target: str,
    code: str,
) -> None:
    normalized_target = normalize_target(target)
    now = utc_now()
    record = db.scalar(
        select(VerificationCode)
        .where(
            VerificationCode.channel == channel,
            VerificationCode.purpose == purpose,
            VerificationCode.target == normalized_target,
            VerificationCode.verified_at.is_(None),
            VerificationCode.revoked_at.is_(None),
        )
        .order_by(VerificationCode.created_at.desc(), VerificationCode.id.desc())
    )

    expires_at = ensure_utc_datetime(record.expires_at) if record else None
    if not record or not expires_at or expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码已过期，请重新获取。",
        )

    if record.attempt_count >= settings.verification_code_max_attempts:
        record.revoked_at = now
        db.add(record)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码尝试次数过多，请重新获取。",
        )

    expected_hash = hash_verification_code(channel, purpose, normalized_target, code)
    if not hmac.compare_digest(record.code_hash, expected_hash):
        record.attempt_count += 1
        if record.attempt_count >= settings.verification_code_max_attempts:
            record.revoked_at = now
        db.add(record)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码错误。",
        )

    record.verified_at = now
    db.add(record)
    db.commit()
