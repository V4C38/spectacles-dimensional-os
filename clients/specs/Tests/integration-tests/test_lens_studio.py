"""Startup-window cleanup tolerates accessibility races without using project focus."""
from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import lens_studio


def response(output: str = "", error: str = "", code: int = 0):
    return subprocess.CompletedProcess([], code, output, error)


class DismissWelcomeTests(unittest.TestCase):
    def test_reenumerates_after_closes_and_retries_only_transient_invalid_index(self):
        replies = [response(error="Can't get window Project. Invalid index. (-1719)", code=1),
                   response("closed\n"), response("closed\n"), response("none\n")]
        with patch.object(lens_studio.subprocess, "run", side_effect=replies) as run, \
                patch.object(lens_studio.time, "sleep") as sleep:
            lens_studio.dismiss_welcome(123)
        self.assertEqual(run.call_count, 4)
        self.assertEqual(sleep.call_count, 3)
        command = run.call_args.args[0]
        self.assertEqual(command[:2], ["osascript", "-e"])
        script = command[2]
        self.assertIn('unix id is 123', script)
        self.assertIn('{"Home", "Welcome", "Welcome to Lens Studio"}', script)
        self.assertIn('first window whose name is welcomeTitle', script)
        self.assertIn('return "closed"', script)
        for forbidden in ('windowIndex', 'activate', 'keystroke', 'set frontmost', 'close every window'):
            self.assertNotIn(forbidden, script)

    def test_permission_and_other_errors_are_not_retried_or_hidden(self):
        for message in ("Not authorized to send Apple events (-1743)",
                        "osascript is not allowed assistive access. (-1719)",
                        "Can't get process (-1728)"):
            with self.subTest(message=message), \
                    patch.object(lens_studio.subprocess, "run", return_value=response(error=message, code=1)) as run, \
                    patch.object(lens_studio.time, "sleep") as sleep:
                with self.assertRaisesRegex(RuntimeError, "Could not dismiss"):
                    lens_studio.dismiss_welcome(123)
                self.assertEqual(run.call_count, 1)
                sleep.assert_not_called()

    def test_repeated_transient_failure_is_bounded(self):
        with patch.object(lens_studio.subprocess, "run", return_value=response(error="Invalid index. (-1719)", code=1)) as run, \
                patch.object(lens_studio.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "Invalid index"):
                lens_studio.dismiss_welcome(123)
        self.assertEqual(run.call_count, 8)
        self.assertEqual(sleep.call_count, 7)

    def test_no_startup_window_is_an_idempotent_noop(self):
        with patch.object(lens_studio.subprocess, "run", return_value=response("none\n")) as run, \
                patch.object(lens_studio.time, "sleep") as sleep:
            lens_studio.dismiss_welcome(123)
        self.assertEqual(run.call_count, 1)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
