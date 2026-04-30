from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


PHONE_PATTERN = re.compile(r"^1[3-9]\d{9}$")


class RegisterRequest(BaseModel):
    phone: str = Field(min_length=11, max_length=20)
    email: EmailStr
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

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return value.strip().lower()

    @field_validator("nickname", "education", "occupation", "organization", "discipline")
    @classmethod
    def strip_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("该字段不能为空。")
        return normalized

    @model_validator(mode="after")
    def validate_register_payload(self) -> "RegisterRequest":
        if self.password != self.confirm_password:
            raise ValueError("两次输入的密码不一致。")
        if not self.agree_terms:
            raise ValueError("请先同意用户协议和隐私政策。")
        return self


class LoginRequest(BaseModel):
    account: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("account")
    @classmethod
    def normalize_account(cls, value: str) -> str:
        return value.strip()


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uid: str
    nickname: str
    avatar_url: str | None = None
    phone: str
    email: str
    education: str
    occupation: str
    organization: str
    discipline: str
    education_verified: bool


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
            raise ValueError("该字段不能为空。")
        return normalized


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
