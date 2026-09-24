from __future__ import annotations

import hashlib
import json
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

BAIDU_ERROR_MESSAGES: dict[str, str] = {
    "52001": "请求超时，请重试",
    "52002": "百度翻译系统错误，请稍后重试",
    "52003": "未授权用户：请检查 APP ID 是否正确并已开通通用翻译服务",
    "54000": "缺少必填参数",
    "54001": "签名校验失败：请检查密钥 (Secret Key) 是否填写正确",
    "54003": "访问频率受限，请稍后重试",
    "54004": "账户余额不足，请前往百度翻译开放平台查看额度",
    "54005": "长文本请求过于频繁，请降低频率",
    "58000": "客户端 IP 非法，请检查百度开放平台的 IP 白名单设置",
    "58001": "不支持的译文语言方向",
    "58002": "服务当前已关闭，请在百度翻译开放平台重新开启",
    "90107": "实名认证未通过或认证未生效",
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


def call_baidu_translate_api(
    text: str,
    appid: str,
    secret: str,
    domain: str = "",
    timeout: int = 10,
) -> tuple[str | None, str | None]:
    """直接调用百度翻译 API。
    返回: (译文结果, 错误信息说明)
    若成功，(result_text, None)
    若失败，(None, error_msg)
    """
    if not appid or not secret:
        return None, "未配置百度翻译 APP ID 或密钥"

    salt = str(random.randint(32768, 2147483647))
    sign_input = appid + text + salt + secret
    sign = hashlib.md5(sign_input.encode("utf-8")).hexdigest()

    params = {
        "q": text,
        "from": "auto",
        "to": "zh",
        "appid": appid,
        "salt": salt,
        "sign": sign,
    }

    if domain and domain in VALID_DOMAINS:
        params["domain"] = domain

    try:
        req = Request(
            BAIDU_API_URL,
            data=urlencode(params).encode("utf-8"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        if "error_code" in data and str(data["error_code"]) != "52000":
            err_code = str(data["error_code"])
            err_msg = data.get("error_msg", "")
            friendly_msg = BAIDU_ERROR_MESSAGES.get(err_code, f"百度翻译错误 [{err_code}]: {err_msg}")
            return None, friendly_msg

        trans_result = data.get("trans_result")
        if trans_result and len(trans_result) > 0:
            return "\n".join(item["dst"] for item in trans_result), None

        return None, "百度翻译未返回有效译文"
    except Exception as exc:
        return None, f"网络请求失败: {str(exc)}"


def _baidu_translate(
    text: str,
    domain: str = "",
    appid: str = "",
    secret: str = "",
) -> str | None:
    """调用百度翻译 API，优先使用传入的凭据，若无则回退系统配置。"""
    effective_appid = appid or settings.baidu_translate_appid
    effective_secret = secret or settings.baidu_translate_secret

    if not effective_appid or not effective_secret:
        return None

    dst, _ = call_baidu_translate_api(text, appid=effective_appid, secret=effective_secret, domain=domain)
    return dst


def translate_title(text: str, discipline: str = "", appid: str = "", secret: str = "") -> str | None:
    """翻译论文标题为中文。已有中文则跳过，失败返回 None 不阻塞导入。"""
    if not text or _has_chinese(text):
        return None

    domain = _map_discipline_to_domain(discipline)
    return _baidu_translate(text, domain=domain, appid=appid, secret=secret)


def translate_text(
    text: str,
    domain: str = "",
    appid: str = "",
    secret: str = "",
) -> str | None:
    """通用文本翻译。已有中文则原样返回，失败时返回 None。"""
    if not text:
        return None

    if _has_chinese(text):
        return text

    if domain and domain not in VALID_DOMAINS:
        domain = ""

    return _baidu_translate(text, domain=domain, appid=appid, secret=secret)
