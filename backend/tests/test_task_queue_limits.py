import unittest

from app.services.membership import (
    PRIORITY_FREE,
    PRIORITY_VIP,
    can_start_background_task,
)


class TaskQueueLimitTest(unittest.TestCase):
    def test_rejects_task_when_same_user_limit_is_reached(self):
        allowed = can_start_background_task(
            priority_value=PRIORITY_VIP,
            counts={"vip": 0, "free": 0},
            total_limit=2,
            vip_reserved=1,
            user_running=1,
            per_user_limit=1,
        )

        self.assertFalse(allowed)

    def test_allows_vip_when_global_and_user_slots_are_available(self):
        allowed = can_start_background_task(
            priority_value=PRIORITY_VIP,
            counts={"vip": 1, "free": 0},
            total_limit=2,
            vip_reserved=1,
            user_running=0,
            per_user_limit=1,
        )

        self.assertTrue(allowed)

    def test_free_user_respects_vip_reserved_slot(self):
        allowed = can_start_background_task(
            priority_value=PRIORITY_FREE,
            counts={"vip": 0, "free": 1},
            total_limit=2,
            vip_reserved=1,
            user_running=0,
            per_user_limit=1,
        )

        self.assertFalse(allowed)


if __name__ == "__main__":
    unittest.main()
