from __future__ import annotations

import hashlib
import random
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.core.config import settings

BAIDU_API_URL = "https://fanyi-api.baidu.com/api/trans/vip/translate"

VALID_DOMAINS: set[str] = {
    "it", "finance", "machinery", "senimed", "academic",
    "aerospace", "news", "law", "contract",
}

DISCIPLINE_DOMAIN_MAP: dict[tuple[str, ...], str] = {
    ("计算机", "软件", "人工智能", "电子", "信息", "数据", "网络", "编程", "算法"): "it",
    ("金融", "经济", "会计", "管理", "商业", "贸易", "财务"): "finance",
    ("机械", "制造", "工程", "材料", "自动化", "电气", "土木"): "machinery",
    ("生物", "医学", "药学", "临床", "化学", "遗传", "免疫", "神经"): "senimed",
    ("文学", "语言", "历史", "哲学", "艺术", "音乐"): "academic",
}


def _has_chinese(text: str) -> bool:
    return any("一" <= c <= "鿿" for c in text)


def _map_discipline_to_domain(discipline: str) -> str:
    if not discipline:
        return "academic"

    for keywords, domain in DISCIPLINE_DOMAIN_MAP.items():
        if any(kw in discipline for kw in keywords):
            return domain

    return "academic"


def _baidu_translate(text: str, domain: str = "") -> str | None:
    """调用百度翻译 API，成功返回译文，失败返回 None。domain 为空时不传领域参数走通用翻译。"""
    if not settings.translate_enabled:
        return None

    salt = str(random.randint(32768, 2147483647))
    sign_input = settings.baidu_translate_appid + text + salt + settings.baidu_translate_secret
    sign = hashlib.md5(sign_input.encode()).hexdigest()

    params = {
        "q": text,
        "from": "auto",
        "to": "zh",
        "appid": settings.baidu_translate_appid,
        "salt": salt,
        "sign": sign,
    }

    if domain:
        params["domain"] = domain

    try:
        req = Request(
            BAIDU_API_URL,
            data=urlencode(params).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp = urlopen(req, timeout=10)
        data = __import__("json").loads(resp.read())

        trans_result = data.get("trans_result")
        if trans_result:
            return trans_result[0]["dst"]
        return None
    except Exception:
        return None


def translate_title(text: str, discipline: str = "") -> str | None:
    """翻译论文标题为中文。已有中文则跳过，失败返回 None 不阻塞导入。"""
    if not text or _has_chinese(text):
        return None

    domain = _map_discipline_to_domain(discipline)
    return _baidu_translate(text, domain=domain)


def translate_text(text: str, domain: str = "") -> str | None:
    """通用文本翻译。已有中文则原样返回，失败时返回 None。domain 为空时走通用翻译。"""
    if not text:
        return None

    if _has_chinese(text):
        return text

    if domain and domain not in VALID_DOMAINS:
        domain = ""

    return _baidu_translate(text, domain=domain)
