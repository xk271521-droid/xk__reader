from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from sqlalchemy.engine import make_url

from app.core.config import _build_database_url, _rewrite_database_url_for_local_runtime


class LocalDatabaseConfigTests(unittest.TestCase):
    def test_local_mode_reuses_connection_credentials_with_local_host(self) -> None:
        original_url = "mysql+pymysql://reader:password@retired.example:3307/xk_reader?charset=utf8mb4"
        environment = {
            "XK_READER_USE_LOCAL_DATABASE": "true",
            "XK_READER_LOCAL_DATABASE_HOST": "127.0.0.1",
            "XK_READER_LOCAL_DATABASE_PORT": "3306",
        }

        with patch.dict(os.environ, environment, clear=False):
            rewritten = make_url(_rewrite_database_url_for_local_runtime(original_url))

        self.assertEqual(rewritten.host, "127.0.0.1")
        self.assertEqual(rewritten.port, 3306)
        self.assertEqual(rewritten.database, "xk_reader")
        self.assertEqual(rewritten.username, "reader")

    def test_local_mode_leaves_sqlite_urls_unchanged(self) -> None:
        with patch.dict(os.environ, {"XK_READER_USE_LOCAL_DATABASE": "true"}, clear=False):
            rewritten = _rewrite_database_url_for_local_runtime("sqlite:///./xk-reader.db")

        self.assertEqual(rewritten, "sqlite:///./xk-reader.db")

    def test_standalone_mode_builds_sqlite_url_without_mysql(self) -> None:
        with patch.dict(
            os.environ,
            {
                "XK_READER_STANDALONE": "true",
                "XK_READER_DATA_DIR": os.path.join(os.environ.get("TEMP", "."), "xk-reader-test-data"),
            },
            clear=False,
        ):
            database_url = _build_database_url()
        self.assertTrue(database_url.startswith("sqlite:///"))
        self.assertNotIn("mysql", database_url)
