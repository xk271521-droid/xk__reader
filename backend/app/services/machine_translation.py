from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from typing import Any
from urllib.request import Request, urlopen

from app.core.config import settings
from app.services.termbase import TermEntry, apply_termbase_corrections


class MachineTranslationUnavailable(RuntimeError):
    pass


def get_translation_engine() -> str:
    engine = (settings.translation_engine or "ai").strip().lower()
    if engine == "tencent_mt" and settings.tencent_mt_available:
        return "tencent_mt"
    return "ai"


def _sign_tencent(payload: str, timestamp: int, action: str) -> dict[str, str]:
    service = "tmt"
    host = "tmt.tencentcloudapi.com"
    algorithm = "TC3-HMAC-SHA256"
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
    canonical_request = "\n".join([
        "POST",
        "/",
        "",
        f"content-type:application/json; charset=utf-8\nhost:{host}\n",
        "content-type;host",
        hashlib.sha256(payload.encode("utf-8")).hexdigest(),
    ])
    credential_scope = f"{date}/{service}/tc3_request"
    string_to_sign = "\n".join([
        algorithm,
        str(timestamp),
        credential_scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])
    secret_date = hmac.new(("TC3" + settings.tencent_secret_key).encode("utf-8"), date.encode("utf-8"), hashlib.sha256).digest()
    secret_service = hmac.new(secret_date, service.encode("utf-8"), hashlib.sha256).digest()
    secret_signing = hmac.new(secret_service, b"tc3_request", hashlib.sha256).digest()
    signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        f"{algorithm} Credential={settings.tencent_secret_id}/{credential_scope}, "
        f"SignedHeaders=content-type;host, Signature={signature}"
    )
    return {
        "Authorization": authorization,
        "Content-Type": "application/json; charset=utf-8",
        "Host": host,
        "X-TC-Action": action,
        "X-TC-Version": "2018-03-21",
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Region": settings.tencent_mt_region,
    }


def _tencent_request(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not settings.tencent_mt_available:
        raise MachineTranslationUnavailable("腾讯云机器翻译未启用或密钥未配置。")
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    timestamp = int(time.time())
    request = Request(
        "https://tmt.tencentcloudapi.com",
        data=body.encode("utf-8"),
        headers=_sign_tencent(body, timestamp, action),
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        raw = response.read().decode("utf-8")
    data = json.loads(raw)
    response_data = data.get("Response") or {}
    if "Error" in response_data:
        error = response_data["Error"]
        raise RuntimeError(f"腾讯云机器翻译失败：{error.get('Code')} {error.get('Message')}")
    return response_data


def translate_with_tencent_mt(
    *,
    items: list[dict[str, str]],
    terms: list[TermEntry],
    source: str = "en",
    target: str = "zh",
) -> dict[str, str]:
    if not items:
        return {}
    result: dict[str, str] = {}
    # Tencent TextTranslate has a 6000-character request limit. Keep batches smaller
    # so one oversized paragraph does not poison a whole paper.
    current: list[dict[str, str]] = []
    current_chars = 0

    def flush() -> None:
        nonlocal current, current_chars
        if not current:
            return
        source_text = "\n<block-splitter/>\n".join(item.get("text", "") for item in current)
        response = _tencent_request(
            "TextTranslate",
            {
                "SourceText": source_text,
                "Source": source,
                "Target": target,
                "ProjectId": 0,
            },
        )
        translated_text = str(response.get("TargetText") or "").strip()
        translated_parts = translated_text.split("\n<block-splitter/>\n")
        if len(translated_parts) != len(current):
            # Some MT engines translate or normalize the separator. Retry one by one.
            translated_parts = []
            for item in current:
                single = _tencent_request(
                    "TextTranslate",
                    {
                        "SourceText": item.get("text", ""),
                        "Source": source,
                        "Target": target,
                        "ProjectId": 0,
                    },
                )
                translated_parts.append(str(single.get("TargetText") or "").strip())
        for item, text in zip(current, translated_parts):
            translated = apply_termbase_corrections(text, terms)
            if translated:
                result[item.get("id", "")] = translated
        current = []
        current_chars = 0

    for item in items:
        text = str(item.get("text") or "")
        if not text.strip():
            continue
        item_chars = len(text)
        if current and current_chars + item_chars > 4800:
            flush()
        current.append(item)
        current_chars += item_chars
        if item_chars > 4800:
            flush()
    flush()
    return result

