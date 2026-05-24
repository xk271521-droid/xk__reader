from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.membership import MembershipMeResponse, MembershipPlansResponse, MembershipRedeemRequest, MembershipRedeemResponse
from app.services.membership import (
    DEFAULT_PLAN_CODE,
    PLAN_CONFIGS,
    build_membership_payload,
    build_plan_response,
    create_membership_notification,
    redeem_code,
)

router = APIRouter(prefix="/membership", tags=["membership"])


@router.get("/me", response_model=MembershipMeResponse)
def get_my_membership(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> MembershipMeResponse:
    payload = build_membership_payload(db, current_user.id)
    return MembershipMeResponse(**payload)


@router.get("/plans", response_model=MembershipPlansResponse)
def get_membership_plans() -> MembershipPlansResponse:
    return MembershipPlansResponse(
        plans=[build_plan_response(plan_code) for plan_code in PLAN_CONFIGS],
        default_plan_code=DEFAULT_PLAN_CODE,
    )


@router.post("/redeem", response_model=MembershipRedeemResponse)
def redeem_membership_code(
    payload: MembershipRedeemRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> MembershipRedeemResponse:
    membership, code = redeem_code(
        db,
        user_id=current_user.id,
        code_value=payload.code,
    )
    create_membership_notification(
        db,
        user_id=current_user.id,
        event_kind="completed",
        title="VIP 已开通",
        message=f"兑换码 {code.code} 已使用成功，当前套餐已更新为 {membership.plan_code}。",
        payload={"source": "redeem_code"},
    )
    next_payload = build_membership_payload(db, current_user.id)
    return MembershipRedeemResponse(
        **next_payload,
        message="兑换成功，VIP 已开通。",
    )
