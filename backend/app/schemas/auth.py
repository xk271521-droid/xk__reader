from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


PHONE_PATTERN = re.compile(r"^1[3-9]\d{9}$")
SMS_CODE_PATTERN = re.compile(r"^\d{6}$")
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class RegisterRequest(BaseModel):
    phone: str = Field(min_length=11, max_length=20)
    phone_verification_code: str = Field(min_length=6, max_length=6)
    email: str | None = None
    email_verification_code: str | None = Field(default=None, min_length=6, max_length=6)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(min_length=2, max_length=80)
    education: str = Field(min_length=1, max_length=50)
    occupation: str = Field(min_length=1, max_length=50)
    organization: str = Field(min_length=1, max_length=120)
    discipline: str = Field(min_length=1, max_length=120)
    agree_terms: bool

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        normalized = value.strip()
        if not PHONE_PATTERN.fullmatch(normalized):
            raise ValueError("手机号格式不正确。")
        return normalized

    @field_validator("phone_verification_code", "email_verification_code")
    @classmethod
    def validate_verification_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not SMS_CODE_PATTERN.fullmatch(normalized):
            raise ValueError("验证码格式不正确。")
        return normalized

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        return normalized or None

    @field_validator(
        "nickname",
        "education",
        "occupation",
        "organization",
        "discipline",
    )
    @classmethod
    def strip_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空。")
        return normalized

    @model_validator(mode="after")
    def validate_register_payload(self) -> "RegisterRequest":
        if self.password != self.confirm_password:
            raise ValueError("两次输入的密码不一致。")
        if self.email and not EMAIL_PATTERN.fullmatch(self.email):
            raise ValueError("邮箱格式不正确。")
        if self.email and not self.email_verification_code:
            raise ValueError("填写邮箱后必须输入邮箱验证码。")
        if not self.email and self.email_verification_code:
            raise ValueError("未填写邮箱时不能提交邮箱验证码。")
        if not self.agree_terms:
            raise ValueError("请先同意用户协议和隐私政策。")
        return self


class LoginRequest(BaseModel):
    account: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    captcha_id: str = Field(min_length=8, max_length=255)
    captcha_code: str = Field(min_length=4, max_length=16)

    @field_validator("account", "captcha_id", "captcha_code")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return value.strip()


class SendVerificationCodeRequest(BaseModel):
    channel: str
    target: str = Field(min_length=4, max_length=255)
    captcha_id: str = Field(min_length=8, max_length=255)
    captcha_code: str = Field(min_length=4, max_length=16)

    @field_validator("channel", "target", "captcha_id", "captcha_code")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_payload(self) -> "SendVerificationCodeRequest":
        if self.channel not in {"sms", "email"}:
            raise ValueError("不支持的验证码通道。")
        if self.channel == "sms" and not PHONE_PATTERN.fullmatch(self.target):
            raise ValueError("手机号格式不正确。")
        if self.channel == "email" and not EMAIL_PATTERN.fullmatch(self.target.lower()):
            raise ValueError("邮箱格式不正确。")
        if self.channel == "email":
            self.target = self.target.lower()
        return self


class SendVerificationCodeResponse(BaseModel):
    cooldown_seconds: int


class SendResetCodeRequest(BaseModel):
    account: str = Field(min_length=3, max_length=255)
    captcha_id: str = Field(min_length=8, max_length=255)
    captcha_code: str = Field(min_length=4, max_length=16)

    @field_validator("account", "captcha_id", "captcha_code")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return value.strip()


class ResetPasswordRequest(BaseModel):
    account: str = Field(min_length=3, max_length=255)
    verification_code: str = Field(min_length=6, max_length=6)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)
    captcha_id: str = Field(min_length=8, max_length=255)
    captcha_code: str = Field(min_length=4, max_length=16)

    @field_validator("account", "captcha_id", "captcha_code")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("verification_code")
    @classmethod
    def validate_verification_code(cls, value: str) -> str:
        normalized = value.strip()
        if not SMS_CODE_PATTERN.fullmatch(normalized):
            raise ValueError("验证码格式不正确。")
        return normalized

    @model_validator(mode="after")
    def validate_payload(self) -> "ResetPasswordRequest":
        if self.password != self.confirm_password:
            raise ValueError("两次输入的密码不一致。")
        return self


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uid: str
    nickname: str
    avatar_url: str | None = None
    phone: str
    email: str | None = None
    education: str
    occupation: str
    organization: str
    discipline: str
    education_verified: bool
    is_admin: bool = False


class UpdateProfileRequest(BaseModel):
    nickname: str = Field(min_length=2, max_length=80)
    education: str = Field(min_length=1, max_length=50)
    occupation: str = Field(min_length=1, max_length=50)
    organization: str = Field(min_length=1, max_length=120)
    discipline: str = Field(min_length=1, max_length=120)

    @field_validator("nickname", "education", "occupation", "organization", "discipline")
    @classmethod
    def strip_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("字段不能为空。")
        return normalized


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class CaptchaChallengeResponse(BaseModel):
    challenge_id: str
    image_data_url: str
    expires_in_seconds: int
