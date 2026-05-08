from __future__ import annotations

import json
from pathlib import Path
from time import sleep
from typing import Any

from app.core.config import settings


class DocMindUnavailable(RuntimeError):
    """阿里云文档智能未配置或 SDK 不可用。"""


def is_docmind_available() -> bool:
    return settings.aliyun_docmind_available


def _require_sdk():
    try:
        from alibabacloud_docmind_api20220711.client import Client  # type: ignore
        from alibabacloud_docmind_api20220711 import models as docmind_models  # type: ignore
        from alibabacloud_tea_openapi import models as open_api_models  # type: ignore
        from alibabacloud_tea_util import models as util_models  # type: ignore
    except Exception as exc:  # pragma: no cover - optional cloud dependency
        raise DocMindUnavailable(
            "阿里云文档智能 SDK 未安装，请安装 alibabacloud_docmind_api20220711。"
        ) from exc
    return Client, docmind_models, open_api_models, util_models


def _client():
    if not settings.aliyun_docmind_available:
        raise DocMindUnavailable("阿里云文档智能未启用或 AccessKey 未配置。")

    Client, _docmind_models, open_api_models, util_models = _require_sdk()
    config = open_api_models.Config(
        access_key_id=settings.aliyun_docmind_access_key_id,
        access_key_secret=settings.aliyun_docmind_access_key_secret,
        region_id=settings.aliyun_docmind_region,
        endpoint=settings.aliyun_docmind_endpoint,
    )
    return Client(config), _docmind_models, util_models


def _read_attr_or_key(value: Any, *names: str) -> Any:
    for name in names:
        if isinstance(value, dict) and name in value:
            return value[name]
        if hasattr(value, name):
            return getattr(value, name)
    return None


def _as_jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool, list, dict)):
        return value
    if hasattr(value, "to_map"):
        return value.to_map()
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return str(value)


def parse_document_with_aliyun(file_path: Path, *, high_precision: bool = False, timeout_seconds: int = 180) -> dict[str, Any]:
    """使用阿里云文档解析（大模型版）解析本地 PDF。

    该函数只负责调用云端并返回标准化结果；调用方负责把 Markdown/版面结果转换成
    全文翻译所需的 page/block 数据结构。
    """
    if not file_path.exists():
        raise FileNotFoundError(str(file_path))

    client, models, util_models = _client()
    runtime = util_models.RuntimeOptions()

    request = models.SubmitDocParserJobAdvanceRequest(
        file_url_object=str(file_path),
        output_format=["markdown", "visualLayoutInfo"],
        formula_enhancement=True,
        llm_enhancement=bool(high_precision),
        enhancement_mode="VLM" if high_precision else None,
    )
    response = client.submit_doc_parser_job_advance(request, runtime)
    data = _read_attr_or_key(getattr(response, "body", None), "data")
    job_id = (
        _read_attr_or_key(data, "id", "job_id", "jobId")
        or _read_attr_or_key(getattr(response, "body", None), "id", "job_id", "jobId")
    )
    if not job_id:
        raise RuntimeError("阿里云文档解析任务提交失败：未返回任务 ID。")

    deadline = timeout_seconds
    while deadline > 0:
        status_response = client.query_doc_parser_status(models.QueryDocParserStatusRequest(id=job_id))
        body = getattr(status_response, "body", None)
        status_data = _read_attr_or_key(body, "data")
        status = str(
            _read_attr_or_key(status_data, "status")
            or _read_attr_or_key(body, "status")
            or ""
        ).lower()
        if status in {"success", "succeeded", "completed", "finish", "finished"}:
            break
        if status in {"fail", "failed", "error"}:
            message = _read_attr_or_key(status_data, "message", "error_message") or _read_attr_or_key(body, "message", "error_message")
            raise RuntimeError(f"阿里云文档解析失败：{message or status}")
        sleep(2)
        deadline -= 2
    else:
        raise TimeoutError("阿里云文档解析超时，请稍后重试。")

    result_response = client.get_doc_parser_result(models.GetDocParserResultRequest(id=job_id))
    body = getattr(result_response, "body", None)
    data = _read_attr_or_key(body, "data") or body
    markdown = (
        _read_attr_or_key(data, "markdown", "content", "result")
        or _read_attr_or_key(body, "markdown", "content", "result")
        or ""
    )
    return {
        "job_id": job_id,
        "markdown": str(markdown or ""),
        "layout": _as_jsonable(_read_attr_or_key(data, "layout", "visual_layout_info", "visualLayoutInfo")),
        "raw": _as_jsonable(data),
    }
