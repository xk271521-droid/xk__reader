import unittest
from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import settings
from app.schemas.auth import LoginRequest
from app.services.security import create_access_token


class AuthRememberMeTest(unittest.TestCase):
    def decode_token(self, token: str) -> dict:
        return jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )

    def test_access_token_accepts_custom_remember_lifetime(self):
        issued_after = datetime.now(timezone.utc)
        token = create_access_token(
            "user-1",
            token_version=2,
            expires_delta=timedelta(days=30),
        )

        payload = self.decode_token(token)
        expires_at = datetime.fromtimestamp(payload["exp"], timezone.utc)

        self.assertEqual(payload["sub"], "user-1")
        self.assertEqual(payload["tv"], 2)
        self.assertGreater(expires_at, issued_after + timedelta(days=29))
        self.assertLess(expires_at, issued_after + timedelta(days=31))

    def test_login_request_accepts_remember_me_flag(self):
        payload = LoginRequest(
            account=" xk@example.com ",
            password="12345678",
            captcha_id="captcha-12345678",
            captcha_code="ABCD",
            remember_me=True,
        )

        self.assertEqual(payload.account, "xk@example.com")
        self.assertTrue(payload.remember_me)


if __name__ == "__main__":
    unittest.main()
