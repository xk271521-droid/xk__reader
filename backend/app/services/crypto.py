from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import settings


def _get_fernet() -> Fernet:
    key_bytes = hashlib.sha256(settings.secret_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def encrypt_api_key(plain: str) -> str:
    f = _get_fernet()
    return f.encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_api_key(encrypted: str) -> str:
    f = _get_fernet()
    return f.decrypt(encrypted.encode("utf-8")).decode("utf-8")
