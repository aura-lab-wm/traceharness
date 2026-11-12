"""No Docker launches: test admission and completion at the subprocess boundary."""
import subprocess
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from traceharness.runner_service.execution import DockerExecutor, ExecutionError


class ExecutionDeadlineBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.executor = DockerExecutor(SimpleNamespace(docker_binary='docker'), None,
            command=lambda args, **_: subprocess.CompletedProcess(args, 0, b'', b''))

    def test_expired_work_is_refused_before_starting_a_container(self):
        with patch('traceharness.runner_service.execution.time.monotonic', return_value=10), \
             patch('traceharness.runner_service.execution.subprocess.Popen', side_effect=AssertionError('expired work was launched')):
            with self.assertRaisesRegex(ExecutionError, 'deadline'):
                self.executor._run(['fixture'], 'fixture-grade', threading.Event(), 9)

    def test_cancelled_work_is_refused_before_starting_a_container(self):
        cancel = threading.Event(); cancel.set()
        with patch('traceharness.runner_service.execution.subprocess.Popen', side_effect=AssertionError('cancelled work was launched')):
            with self.assertRaisesRegex(ExecutionError, 'cancelled'):
                self.executor._run(['fixture'], 'fixture', cancel, float('inf'))

    def test_finished_grader_cannot_report_success_after_deadline(self):
        process = SimpleNamespace(poll=lambda: 0, returncode=0)
        with patch('traceharness.runner_service.execution.time.monotonic', side_effect=[0, 11]), \
             patch('traceharness.runner_service.execution.subprocess.Popen', return_value=process):
            with self.assertRaisesRegex(ExecutionError, 'deadline'):
                self.executor._run(['fixture'], 'fixture-grade', threading.Event(), 10)
