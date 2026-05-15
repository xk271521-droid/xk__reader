from __future__ import annotations

import base64
import html
import random
import secrets
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from time import time

from fastapi import HTTPException, status

from app.core.config import settings


AUTH_SCENES = {"login", "register"}
CAPTCHA_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


@dataclass(slots=True)
class CaptchaChallenge:
    challenge_id: str
    scene: str
    answer: str
    expires_at: float


@dataclass(slots=True)
class AttemptBucket:
    attempts: deque[float] = field(default_factory=deque)
    blocked_until: float = 0.0


class AuthGuard:
    def __init__(self) -> None:
        self._lock = Lock()
        self._challenges: dict[str, CaptchaChallenge] = {}
        self._ip_buckets: dict[str, AttemptBucket] = {}
        self._account_buckets: dict[str, AttemptBucket] = {}

    def create_challenge(self, scene: str) -> dict[str, str | int]:
        self._validate_scene(scene)
        now = time()
        code = "".join(secrets.choice(CAPTCHA_ALPHABET) for _ in range(settings.auth_captcha_length))
        challenge = CaptchaChallenge(
            challenge_id=secrets.token_urlsafe(24),
            scene=scene,
            answer=code.upper(),
            expires_at=now + settings.auth_captcha_ttl_seconds,
        )

        with self._lock:
            self._cleanup(now)
            self._challenges[challenge.challenge_id] = challenge

        return {
            "challenge_id": challenge.challenge_id,
            "image_data_url": self._build_captcha_data_url(code),
            "expires_in_seconds": settings.auth_captcha_ttl_seconds,
        }

    def verify_challenge(self, scene: str, challenge_id: str, challenge_code: str) -> None:
        self._validate_scene(scene)
        normalized_id = challenge_id.strip()
        normalized_code = challenge_code.strip().upper()
        now = time()

        with self._lock:
            self._cleanup(now)
            challenge = self._challenges.pop(normalized_id, None)

        if not challenge or challenge.scene != scene or challenge.expires_at <= now:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="验证码已失效，请刷新后重试。",
            )

        if challenge.answer != normalized_code:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="验证码错误，请重新输入。",
            )

    def ensure_request_allowed(
        self,
        scene: str,
        ip_address: str,
        account_keys: list[str] | tuple[str, ...] | None = None,
    ) -> None:
        self._validate_scene(scene)
        now = time()
        policy = self._policy_for(scene)
        normalized_account_keys = self._normalize_account_keys(account_keys)

        with self._lock:
            self._cleanup(now)
            self._ensure_bucket_allowed(
                self._ip_buckets.get(self._ip_bucket_key(scene, ip_address)),
                now,
            )
            for account_key in normalized_account_keys:
                self._ensure_bucket_allowed(
                    self._account_buckets.get(self._account_bucket_key(scene, account_key)),
                    now,
                )

            ip_bucket = self._ip_buckets.get(self._ip_bucket_key(scene, ip_address))
            if ip_bucket and len(ip_bucket.attempts) >= policy["max_attempts_per_ip"]:
                ip_bucket.blocked_until = now + settings.auth_rate_limit_block_seconds
                raise self._rate_limit_exception()

            for account_key in normalized_account_keys:
                account_bucket = self._account_buckets.get(self._account_bucket_key(scene, account_key))
                if account_bucket and len(account_bucket.attempts) >= policy["max_attempts_per_account"]:
                    account_bucket.blocked_until = now + settings.auth_rate_limit_block_seconds
                    raise self._rate_limit_exception()

    def record_failure(
        self,
        scene: str,
        ip_address: str,
        account_keys: list[str] | tuple[str, ...] | None = None,
    ) -> None:
        self._validate_scene(scene)
        now = time()
        policy = self._policy_for(scene)
        normalized_account_keys = self._normalize_account_keys(account_keys)

        with self._lock:
            self._cleanup(now)
            ip_bucket = self._touch_bucket(self._ip_buckets, self._ip_bucket_key(scene, ip_address), now)
            ip_bucket.attempts.append(now)
            if len(ip_bucket.attempts) >= policy["max_attempts_per_ip"]:
                ip_bucket.blocked_until = now + settings.auth_rate_limit_block_seconds

            for account_key in normalized_account_keys:
                account_bucket = self._touch_bucket(
                    self._account_buckets,
                    self._account_bucket_key(scene, account_key),
                    now,
                )
                account_bucket.attempts.append(now)
                if len(account_bucket.attempts) >= policy["max_attempts_per_account"]:
                    account_bucket.blocked_until = now + settings.auth_rate_limit_block_seconds

    def record_success(
        self,
        scene: str,
        account_keys: list[str] | tuple[str, ...] | None = None,
    ) -> None:
        self._validate_scene(scene)
        normalized_account_keys = self._normalize_account_keys(account_keys)
        if not normalized_account_keys:
            return

        with self._lock:
            for account_key in normalized_account_keys:
                self._account_buckets.pop(self._account_bucket_key(scene, account_key), None)

    def _policy_for(self, scene: str) -> dict[str, int]:
        if scene == "register":
            return {
                "max_attempts_per_ip": settings.auth_register_max_attempts_per_ip,
                "max_attempts_per_account": settings.auth_register_max_attempts_per_account,
            }
        return {
            "max_attempts_per_ip": settings.auth_login_max_attempts_per_ip,
            "max_attempts_per_account": settings.auth_login_max_attempts_per_account,
        }

    def _build_captcha_data_url(self, code: str) -> str:
        width = 132
        height = 48
        rng = random.Random(secrets.randbits(64))
        lines: list[str] = []
        dots: list[str] = []
        chars: list[str] = []

        for _ in range(6):
            x1 = rng.randint(0, width)
            y1 = rng.randint(0, height)
            x2 = rng.randint(0, width)
            y2 = rng.randint(0, height)
            lines.append(
                f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
                'stroke="rgba(31,41,55,0.18)" stroke-width="1.2" />'
            )

        for _ in range(18):
            cx = rng.randint(4, width - 4)
            cy = rng.randint(4, height - 4)
            radius = rng.randint(1, 2)
            dots.append(
                f'<circle cx="{cx}" cy="{cy}" r="{radius}" fill="rgba(71,85,105,0.16)" />'
            )

        for index, char in enumerate(code):
            x = 18 + index * 24 + rng.randint(-2, 2)
            y = 31 + rng.randint(-4, 4)
            rotation = rng.randint(-18, 18)
            chars.append(
                f'<text x="{x}" y="{y}" transform="rotate({rotation} {x} {y})">{html.escape(char)}</text>'
            )

        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" role="img" aria-label="captcha">'
            '<rect width="100%" height="100%" rx="18" fill="#F8FAFC" />'
            '<rect x="1" y="1" width="130" height="46" rx="17" fill="none" stroke="#CBD5E1" />'
            f'{"".join(lines)}'
            f'{"".join(dots)}'
            '<g fill="#111827" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="2">'
            f'{"".join(chars)}'
            "</g>"
            "</svg>"
        )
        encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
        return f"data:image/svg+xml;base64,{encoded}"

    def _touch_bucket(self, store: dict[str, AttemptBucket], key: str, now: float) -> AttemptBucket:
        bucket = store.get(key)
        if bucket is None:
            bucket = AttemptBucket()
            store[key] = bucket
        self._prune_bucket(bucket, now)
        return bucket

    def _ensure_bucket_allowed(self, bucket: AttemptBucket | None, now: float) -> None:
        if bucket is None:
            return
        self._prune_bucket(bucket, now)
        if bucket.blocked_until > now:
            raise self._rate_limit_exception()

    def _cleanup(self, now: float) -> None:
        expired_challenges = [
            challenge_id
            for challenge_id, challenge in self._challenges.items()
            if challenge.expires_at <= now
        ]
        for challenge_id in expired_challenges:
            self._challenges.pop(challenge_id, None)

        self._cleanup_bucket_store(self._ip_buckets, now)
        self._cleanup_bucket_store(self._account_buckets, now)

    def _cleanup_bucket_store(self, store: dict[str, AttemptBucket], now: float) -> None:
        removable: list[str] = []
        for key, bucket in store.items():
            self._prune_bucket(bucket, now)
            if not bucket.attempts and bucket.blocked_until <= now:
                removable.append(key)
        for key in removable:
            store.pop(key, None)

    def _prune_bucket(self, bucket: AttemptBucket, now: float) -> None:
        window_start = now - settings.auth_rate_limit_window_seconds
        while bucket.attempts and bucket.attempts[0] < window_start:
            bucket.attempts.popleft()
        if bucket.blocked_until <= now and not bucket.attempts:
            bucket.blocked_until = 0.0

    def _validate_scene(self, scene: str) -> None:
        if scene not in AUTH_SCENES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="不支持的验证码场景。",
            )

    def _normalize_account_keys(
        self,
        account_keys: list[str] | tuple[str, ...] | None,
    ) -> list[str]:
        if not account_keys:
            return []
        normalized: list[str] = []
        for account_key in account_keys:
            if account_key is None:
                continue
            item = account_key.strip().lower()
            if item and item not in normalized:
                normalized.append(item)
        return normalized

    def _ip_bucket_key(self, scene: str, ip_address: str) -> str:
        return f"{scene}:ip:{ip_address}"

    def _account_bucket_key(self, scene: str, account_key: str) -> str:
        return f"{scene}:account:{account_key.strip().lower()}"

    def _rate_limit_exception(self) -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="操作过于频繁，请稍后再试。",
        )


auth_guard = AuthGuard()
