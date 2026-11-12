"""Fresh-process import contract for killable provider workers; no network."""
import subprocess
import sys
import unittest


class ProviderImportBoundaryTests(unittest.TestCase):
    def test_provider_worker_does_not_load_the_asgi_application(self):
        # Spawned provider workers import their package before forwarding. Loading
        # FastAPI and every controller route here spends their network deadline
        # before any transport operation can run.
        result = subprocess.run(
            [sys.executable, '-c',
             'import sys; import traceharness.runner_service.provider; '
             'assert "traceharness.runner_service.service" not in sys.modules; '
             'assert "fastapi" not in sys.modules'],
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
