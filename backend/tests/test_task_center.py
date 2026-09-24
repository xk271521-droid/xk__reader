import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models import Folder, Paper, PaperAiOutline, PaperFullTranslation, PaperReadingBrief, User
from app.services.task_center import archive_task_entries, build_task_center_payload


class TaskCenterServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        self.Session = sessionmaker(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)
        self.db = self.Session()
        self.user = User(uid="task-center-user", phone="13000000002", password_hash="hash")
        folder = Folder(user=self.user, name="papers")
        self.papers = [
            Paper(user=self.user, folder=folder, file_name=f"paper-{index}.pdf", file_path=f"/tmp/{index}.pdf", file_size="1 KB", title=f"Paper {index}")
            for index in range(1, 4)
        ]
        self.db.add_all([self.user, folder, *self.papers])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()

    def test_collects_durable_jobs_and_archives_finished_history(self) -> None:
        self.db.add_all([
            PaperFullTranslation(paper_id=self.papers[0].id, status="running", completed_units=0, total_units=1),
            PaperReadingBrief(paper_id=self.papers[1].id, user_id=self.user.id, status="failed", stage="generating_brief", progress=45, error_message="provider timeout"),
            PaperAiOutline(paper_id=self.papers[2].id, user_id=self.user.id, status="completed", stage="completed", progress=100),
        ])
        self.db.commit()

        snapshot = build_task_center_payload(self.db, self.user.id)

        self.assertEqual(snapshot["summary"], {
            "active_count": 1,
            "failed_count": 1,
            "completed_count": 1,
            "total_count": 3,
            "attention_count": 2,
        })
        items = {item["source_kind"]: item for item in snapshot["items"]}
        self.assertTrue(items["full_translation"]["can_cancel"])
        self.assertTrue(items["reading_brief"]["can_retry"])
        self.assertEqual(items["ai_outline"]["action_kind"], "open-ai-outline")

        archived_ids, skipped_ids = archive_task_entries(
            self.db,
            self.user.id,
            [items["reading_brief"]["id"], items["ai_outline"]["id"], items["full_translation"]["id"]],
        )

        self.assertEqual(len(archived_ids), 2)
        self.assertEqual(skipped_ids, [items["full_translation"]["id"]])
        remaining = build_task_center_payload(self.db, self.user.id)
        self.assertEqual(remaining["summary"]["active_count"], 1)
        self.assertEqual(remaining["summary"]["total_count"], 1)


if __name__ == "__main__":
    unittest.main()
