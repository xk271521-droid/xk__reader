from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import settings


@dataclass(frozen=True)
class TermEntry:
    source: str
    target: str
    case_sensitive: bool = False
    protect: bool = True


def _default_terms() -> list[TermEntry]:
    return [
        TermEntry("CNN", "CNN", True, True),
        TermEntry("GWO", "GWO", True, True),
        TermEntry("CNN-GWO", "CNN-GWO", True, True),
        TermEntry("Convolutional Neural Network", "卷积神经网络"),
        TermEntry("Grey Wolf Optimization", "灰狼优化"),
        TermEntry("feature extraction", "特征提取"),
        TermEntry("classification performance", "分类性能"),
        TermEntry("classification accuracy", "分类准确率"),
        TermEntry("deep learning", "深度学习"),
        TermEntry("neural network", "神经网络"),
        TermEntry("dataset", "数据集"),
        TermEntry("benchmark", "基准"),
        TermEntry("computer vision", "计算机视觉"),
        TermEntry("action recognition", "动作识别"),
        TermEntry("optimization algorithm", "优化算法"),
        TermEntry("fitness function", "适应度函数"),
        TermEntry("local optimum", "局部最优"),
        TermEntry("global search", "全局搜索"),
    ]


def _load_raw_terms() -> list[dict[str, Any]]:
    path = Path(settings.termbase_path)
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if isinstance(payload, dict):
        payload = payload.get("terms") or []
    return payload if isinstance(payload, list) else []


def load_termbase() -> tuple[list[TermEntry], str]:
    terms = _default_terms()
    for raw in _load_raw_terms():
        if not isinstance(raw, dict):
            continue
        source = str(raw.get("source") or raw.get("en") or "").strip()
        target = str(raw.get("target") or raw.get("zh") or "").strip()
        if not source or not target:
            continue
        terms.append(
            TermEntry(
                source=source,
                target=target,
                case_sensitive=bool(raw.get("case_sensitive", False)),
                protect=bool(raw.get("protect", True)),
            )
        )
    deduped: dict[str, TermEntry] = {}
    for term in terms:
        key = term.source if term.case_sensitive else term.source.lower()
        deduped[key] = term
    ordered = sorted(deduped.values(), key=lambda item: len(item.source), reverse=True)
    version_payload = [
        {
            "source": item.source,
            "target": item.target,
            "case_sensitive": item.case_sensitive,
            "protect": item.protect,
        }
        for item in ordered
    ]
    version = hashlib.sha256(json.dumps(version_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:12]
    return ordered, version


def apply_termbase_corrections(text: str, terms: list[TermEntry]) -> str:
    value = str(text or "")
    if not value:
        return ""
    for term in terms:
        if not term.target:
            continue
        flags = 0 if term.case_sensitive else re.IGNORECASE
        pattern = re.compile(rf"(?<![A-Za-z0-9_-]){re.escape(term.source)}(?![A-Za-z0-9_-])", flags)
        value = pattern.sub(term.target, value)
    return value

