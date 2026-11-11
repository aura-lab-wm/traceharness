"""A failed derived-index initialization must release its SQLite connection before recovery."""
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from traceharness.backend import store


class ConnectionInitialization(unittest.TestCase):
    def test_pragma_failure_closes_the_connection_and_preserves_the_error(self):
        connection = MagicMock()
        error = sqlite3.OperationalError("disk I/O error")
        connection.execute.side_effect = error
        with tempfile.TemporaryDirectory() as directory, patch.object(store.sqlite3, "connect", return_value=connection):
            with self.assertRaises(sqlite3.OperationalError) as raised:
                store._connect(os.path.join(directory, "index.sqlite"))
        self.assertIs(raised.exception, error)
        connection.close.assert_called_once_with()

    def test_invalid_schema_metadata_also_releases_the_open_connection(self):
        connection = MagicMock()
        connection.execute.return_value.fetchone.return_value = {"v": "invalid schema version"}
        with tempfile.TemporaryDirectory() as directory, patch.object(store.sqlite3, "connect", return_value=connection):
            with self.assertRaises(ValueError):
                store._connect(os.path.join(directory, "index.sqlite"))
        connection.close.assert_called_once_with()

    def test_successful_initialization_keeps_the_connection_usable_for_its_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            connection = store._connect(os.path.join(directory, "index.sqlite"))
            try:
                self.assertEqual(connection.execute("SELECT v FROM meta WHERE k='schema'").fetchone()["v"], str(store.SCHEMA_VERSION))
            finally:
                connection.close()

    @unittest.skipUnless(sys.version_info >= (3, 13), "SQLite connection ResourceWarning requires Python 3.13+")
    def test_process_shutdown_closes_cached_connections(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, "-Walways::ResourceWarning", "-c",
                 "import sys; from traceharness.backend import store; store._db(sys.argv[1])",
                 os.path.join(directory, "index.sqlite")],
                capture_output=True, text=True, check=False, timeout=15,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("unclosed database", result.stderr)


if __name__ == "__main__":
    unittest.main()
