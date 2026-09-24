import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models import Folder, Paper, User
from app.models.pdf_annotation import PaperAnnotationState, PdfAnnotation
from pydantic import ValidationError

from app.api.routes.pdf_annotation import _ensure_owned_paper
from app.schemas.pdf_annotation import PdfAnnotationDelete, PdfAnnotationSyncRequest, PdfAnnotationUpsert
from app.services.pdf_annotation_sync import (
    clear_pdf_annotations,
    get_annotation_revision,
    parse_annotation_payload,
    sync_pdf_annotations,
)


class PdfAnnotationSyncTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False, expire_on_commit=False)
        self.db = self.Session()
        self.user = User(
            uid="pdf-annotation-user",
            phone="pdf-annotation-user",
            email="pdf-annotation@example.com",
            password_hash="x",
            status="active",
        )
        self.folder = Folder(user=self.user, name="Library")
        self.paper = Paper(
            user=self.user,
            folder=self.folder,
            file_name="paper.pdf",
            file_path="/uploads/papers/paper.pdf",
            file_size="1",
            title="PDF Annotation Paper",
        )
        self.db.add_all([self.user, self.folder, self.paper])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _highlight(self, *, uid: str = "anno-1", base_version: int = 0, color: str = "#f3b300"):
        return PdfAnnotationUpsert(
            uid=uid,
            page_index=0,
            annotation_type="highlight",
            payload={"uid": uid, "pageIndex": 0, "strokeColor": color},
            base_version=base_version,
        )

    def test_creates_updates_and_lists_a_canonical_annotation(self) -> None:
        created = sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=0,
            upserts=[self._highlight()],
            deletes=[],
        )

        self.assertEqual(created.revision, 1)
        self.assertEqual(created.applied_uids, ["anno-1"])
        self.assertEqual(len(created.annotations), 1)
        self.assertEqual(created.annotations[0].version, 1)

        updated = sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=1,
            upserts=[self._highlight(base_version=1, color="#16a34a")],
            deletes=[],
        )

        self.assertEqual(updated.revision, 2)
        self.assertEqual(updated.annotations[0].version, 2)
        self.assertEqual(parse_annotation_payload(updated.annotations[0].payload_json)["strokeColor"], "#16a34a")

    def test_reading_revision_does_not_create_state_row(self) -> None:
        self.assertEqual(
            get_annotation_revision(
                self.db,
                user_id=self.user.id,
                paper_id=self.paper.id,
            ),
            0,
        )
        self.assertEqual(self.db.query(PaperAnnotationState).count(), 0)

    def test_same_upsert_retry_is_idempotent(self) -> None:
        operation = self._highlight()
        first = sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=0,
            upserts=[operation],
            deletes=[],
        )
        retried = sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=0,
            upserts=[operation],
            deletes=[],
        )

        self.assertEqual(first.revision, 1)
        self.assertEqual(retried.revision, 1)
        self.assertEqual(len(retried.annotations), 1)
        self.assertFalse(retried.conflicts)

    def test_version_conflict_preserves_server_value(self) -> None:
        sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=0,
            upserts=[self._highlight()],
            deletes=[],
        )
        sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=1,
            upserts=[self._highlight(base_version=1, color="#16a34a")],
            deletes=[],
        )

        conflicted = sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=1,
            upserts=[self._highlight(base_version=1, color="#2563eb")],
            deletes=[],
        )

        self.assertEqual(conflicted.revision, 2)
        self.assertEqual(len(conflicted.conflicts), 1)
        self.assertEqual(conflicted.conflicts[0].reason, "version_conflict")
        self.assertEqual(parse_annotation_payload(conflicted.annotations[0].payload_json)["strokeColor"], "#16a34a")

    def test_delete_retry_and_clear_use_tombstones(self) -> None:
        created = sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=0,
            upserts=[self._highlight(), self._highlight(uid="anno-2")],
            deletes=[],
        )
        deleted = sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=created.revision,
            upserts=[],
            deletes=[PdfAnnotationDelete(uid="anno-1", base_version=1)],
        )
        retried = sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=created.revision,
            upserts=[],
            deletes=[PdfAnnotationDelete(uid="anno-1", base_version=1)],
        )

        self.assertEqual(deleted.revision, 2)
        self.assertEqual(retried.revision, 2)
        self.assertEqual([item.uid for item in retried.annotations], ["anno-2"])

        cleared = clear_pdf_annotations(self.db, user_id=self.user.id, paper_id=self.paper.id)
        self.assertEqual(cleared.revision, 3)
        self.assertEqual(cleared.annotations, [])
        self.assertEqual(self.db.query(PdfAnnotation).count(), 2)
        self.assertEqual(self.db.query(PaperAnnotationState).one().revision, 3)

    def test_rejects_unknown_annotation_type_without_changing_revision(self) -> None:
        operation = PdfAnnotationUpsert(
            uid="unknown-1",
            page_index=0,
            annotation_type="notSupported",
            payload={"uid": "unknown-1"},
            base_version=0,
        )
        result = sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=0,
            upserts=[operation],
            deletes=[],
        )

        self.assertEqual(result.revision, 0)
        self.assertEqual(result.annotations, [])
        self.assertEqual(result.conflicts[0].reason, "unsupported_annotation_type")

    def test_offline_delete_creates_a_tombstone_that_blocks_stale_recreation(self) -> None:
        deleted = sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=0,
            upserts=[],
            deletes=[PdfAnnotationDelete(uid="offline-1", base_version=0)],
        )
        recreated = sync_pdf_annotations(
            self.db,
            user_id=self.user.id,
            paper_id=self.paper.id,
            base_revision=0,
            upserts=[self._highlight(uid="offline-1")],
            deletes=[],
        )

        self.assertEqual(deleted.revision, 1)
        self.assertEqual(deleted.annotations, [])
        self.assertEqual(recreated.revision, 1)
        self.assertEqual(recreated.conflicts[0].reason, "version_conflict")

    def test_sync_schema_rejects_duplicate_uids_across_operations(self) -> None:
        with self.assertRaises(ValidationError):
            PdfAnnotationSyncRequest(
                base_revision=0,
                upserts=[self._highlight(uid="duplicate-1")],
                deletes=[PdfAnnotationDelete(uid="duplicate-1", base_version=0)],
            )

    def test_owned_paper_check_hides_another_users_paper(self) -> None:
        other_user = User(
            uid="other-pdf-annotation-user",
            phone="other-pdf-annotation-user",
            email="other-pdf-annotation@example.com",
            password_hash="x",
            status="active",
        )
        self.db.add(other_user)
        self.db.commit()

        with self.assertRaisesRegex(Exception, "404"):
            _ensure_owned_paper(self.paper.id, other_user, self.db)


if __name__ == "__main__":
    unittest.main()
