"""Owned idle-lock guard lifecycle without launching Lens Studio."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import ls_awake


class KeepAwakeTests(unittest.TestCase):
    @patch.object(ls_awake.sys, "platform", "darwin")
    @patch.object(ls_awake.subprocess, "Popen")
    def test_exception_releases_only_owned_assertion(self, popen):
        process = popen.return_value
        process.poll.return_value = None
        with self.assertRaisesRegex(RuntimeError, "work failed"):
            with ls_awake.KeepAwake(600):
                raise RuntimeError("work failed")
        command = popen.call_args.args[0]
        self.assertEqual(command[:5], ["/usr/bin/caffeinate", "-d", "-i", "-u", "-t"])
        self.assertEqual(command[5:], ["600", "-w", str(ls_awake.os.getpid())])
        process.terminate.assert_called_once()
        process.wait.assert_called_once_with(timeout=3)

    @patch.object(ls_awake.sys, "platform", "darwin")
    @patch.object(ls_awake.subprocess, "Popen")
    def test_nested_guards_release_independently(self, popen):
        first, second = Mock(), Mock()
        first.poll.return_value = second.poll.return_value = None
        popen.side_effect = [first, second]
        with ls_awake.KeepAwake():
            with ls_awake.KeepAwake():
                pass
            second.terminate.assert_called_once()
            first.terminate.assert_not_called()
        first.terminate.assert_called_once()

    @patch.object(ls_awake.sys, "platform", "darwin")
    @patch.object(ls_awake.subprocess, "Popen")
    def test_stuck_process_is_reaped(self, popen):
        process = popen.return_value
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired("caffeinate", 3), 0]
        with ls_awake.KeepAwake():
            pass
        process.kill.assert_called_once()

    @patch.object(ls_awake.subprocess, "Popen")
    def test_context_renews_before_timeout_without_total_lifetime_limit(self, popen):
        guard = ls_awake.KeepAwake(60)
        previous = Mock()
        previous.poll.return_value = None
        guard.process = previous
        guard._stop = Mock()
        guard._stop.wait.side_effect = [False, False, True]
        replacement = popen.return_value
        replacement.poll.return_value = None
        guard._renew()
        self.assertEqual(popen.call_count, 2)
        self.assertEqual(guard._stop.wait.call_args_list[0].args, (45.0,))
        previous.terminate.assert_called_once()
        self.assertIs(guard.process, replacement)

    @patch.object(ls_awake.sys, "platform", "darwin")
    @patch.object(ls_awake.subprocess, "Popen")
    def test_startup_failure_is_reported_and_reaped(self, popen):
        process = popen.return_value
        process.poll.return_value = 1
        guard = ls_awake.KeepAwake()
        with self.assertRaisesRegex(RuntimeError, "failed to start"):
            guard.__enter__()
        self.assertIsNone(guard.process)
        process.wait.assert_called_once_with()

    @patch.object(ls_awake.sys, "platform", "darwin")
    @patch.object(ls_awake.threading.Thread, "start", side_effect=RuntimeError("thread failed"))
    @patch.object(ls_awake.subprocess, "Popen")
    def test_thread_start_failure_releases_assertion(self, popen, _start):
        process = popen.return_value
        process.poll.return_value = None
        guard = ls_awake.KeepAwake()
        with self.assertRaisesRegex(RuntimeError, "thread failed"):
            guard.__enter__()
        process.terminate.assert_called_once()
        self.assertIsNone(guard.process)

    def test_renewal_failure_preserves_prior_until_exit_and_reports_error(self):
        guard = ls_awake.KeepAwake(60)
        process = Mock()
        process.poll.return_value = None
        guard.process = process
        guard._stop = Mock()
        guard._stop.wait.return_value = False
        with patch.object(guard, "_launch", side_effect=OSError("launch failed")):
            guard._renew()
        process.terminate.assert_not_called()
        self.assertIs(guard.process, process)
        with self.assertRaisesRegex(RuntimeError, "renewal failed"):
            guard.__exit__(None)
        process.terminate.assert_called_once()

    def test_timeout_and_lease_validation(self):
        for timeout in (0, -1, 86401, True, "60"):
            with self.assertRaises(ValueError):
                ls_awake.KeepAwake(timeout)
        for lease in ("../other", "a/b", "", "x" * 81):
            with self.assertRaises(ValueError):
                ls_awake._path(lease)
        for pid in (0, 1, -1, True, "123"):
            with self.assertRaises(ValueError):
                ls_awake._identity(pid)

    @patch.object(ls_awake.sys, "platform", "linux")
    @patch.object(ls_awake.subprocess, "Popen")
    def test_non_macos_context_is_noop(self, popen):
        with ls_awake.KeepAwake():
            pass
        popen.assert_not_called()


class LeaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = patch.object(ls_awake, "LEASE_ROOT", Path(self.directory.name))
        self.root.start()
        self.addCleanup(self.root.stop)
        self.data = dict(pid=123, identity="original process", token="a" * 32,
                         owner_pid=456, owner_identity="owner", timeout=60)

    @patch.object(ls_awake.os, "kill")
    @patch.object(ls_awake, "_identity", return_value="reused process")
    def test_stale_lease_never_signals_reused_pid(self, _identity, kill):
        ls_awake._path("task").write_text(json.dumps(self.data))
        self.assertTrue(ls_awake.stop("task"))
        kill.assert_not_called()

    @patch.object(ls_awake.os, "kill")
    def test_malformed_lease_rejected_without_signal(self, kill):
        self.data["pid"] = True
        ls_awake._path("task").write_text(json.dumps(self.data))
        with self.assertRaises(ValueError):
            ls_awake.stop("task")
        kill.assert_not_called()

    @patch.object(ls_awake, "_identity")
    @patch.object(ls_awake, "KeepAwake")
    def test_worker_releases_guard_when_owner_exits(self, guard, identity):
        path = ls_awake._path("task")
        identity.side_effect = ["owner", "worker", None]
        context = guard.return_value
        context.__enter__.return_value.process.poll.return_value = None
        args = argparse.Namespace(lease="task", owner_pid=456, owner_identity="owner",
                                  timeout=60, token="a" * 32)
        with patch.object(ls_awake.signal, "signal"), patch.object(ls_awake.time, "sleep"):
            ls_awake._worker(args)
        context.__exit__.assert_called_once()
        self.assertFalse(path.exists())

    @patch.object(ls_awake, "_identity")
    @patch.object(ls_awake, "KeepAwake")
    def test_detached_lease_still_has_explicit_total_timeout(self, guard, identity):
        identity.side_effect = ["owner", "worker"]
        context = guard.return_value
        context.__enter__.return_value.process.poll.return_value = None
        args = argparse.Namespace(lease="task", owner_pid=456, owner_identity="owner",
                                  timeout=60, token="a" * 32)
        with patch.object(ls_awake.signal, "signal"), patch.object(ls_awake.time, "sleep"), \
                patch.object(ls_awake.time, "monotonic", side_effect=[0, 61]):
            ls_awake._worker(args)
        context.__exit__.assert_called_once()
        self.assertFalse(ls_awake._path("task").exists())


if __name__ == "__main__":
    unittest.main()
