"""The review guard surrounds the entire coordinator, not just its recorder."""
import argparse
from pathlib import Path
import sys
import unittest
import tempfile
import subprocess
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import review


class ReviewAwakeTests(unittest.TestCase):
    def test_guard_stays_active_until_full_coordinator_returns(self):
        events = []

        class Guard:
            def __enter__(self):
                events.append("acquire")

            def __exit__(self, *_args):
                events.append("release")

        def coordinate(_args):
            events.extend(["prepare", "record", "restore", "handoff", "publish"])
            return 0

        with patch.object(review, "arguments", return_value=argparse.Namespace(prepare_only=False)), \
                patch.object(review, "KeepAwake", Guard), \
                patch.object(review, "_run", side_effect=coordinate):
            self.assertEqual(review.main(), 0)
        self.assertEqual(events, ["acquire", "prepare", "record", "restore", "handoff", "publish", "release"])

    def test_guard_releases_when_coordinator_raises(self):
        with patch.object(review, "arguments", return_value=argparse.Namespace(prepare_only=False)), \
                patch.object(review, "KeepAwake") as guard, \
                patch.object(review, "_run", side_effect=RuntimeError("handoff failed")):
            guard.return_value.__exit__.return_value = False
            with self.assertRaisesRegex(RuntimeError, "handoff failed"):
                review.main()
            guard.return_value.__exit__.assert_called_once()

    def test_prepare_only_needs_no_editor_guard(self):
        with patch.object(review, "arguments", return_value=argparse.Namespace(prepare_only=True)), \
                patch.object(review, "KeepAwake") as guard, \
                patch.object(review, "_run", return_value=0):
            self.assertEqual(review.main(), 0)
            guard.assert_not_called()


class SharedFocusBudgetTests(unittest.IsolatedAsyncioTestCase):
    async def test_aborted_budget_cannot_be_reset_by_a_new_output_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            budget = root / "shared" / "focus-budget"
            budget.parent.mkdir()
            budget.with_suffix(".aborted").write_text("focus limit")
            output = root / "retry"
            output.mkdir()
            args = argparse.Namespace(focus_budget=budget, keep_open=False, mcp_config=None)
            with patch.object(review, "run_review", new_callable=AsyncMock,
                              side_effect=review.ReviewError("failed")), \
                    patch.object(review, "restore_source_project", new_callable=AsyncMock) as restore, \
                    patch.object(review, "LensMcp", side_effect=RuntimeError("offline")):
                with self.assertRaisesRegex(review.ReviewError, "failed"):
                    await review.review_and_restore(args, output, root / "workspace")
            self.assertEqual(args.focus_budget, budget)
            restore.assert_not_awaited()
            self.assertTrue(budget.with_suffix(".aborted").exists())

    def test_cli_resolves_explicit_shared_budget(self):
        with patch.object(sys, "argv", ["review.py", "--focus-budget", "Review Data/shared/focus-budget"]):
            self.assertEqual(review.arguments().focus_budget, Path("Review Data/shared/focus-budget").resolve())


class EditorProcessTests(unittest.TestCase):
    def test_uses_exact_main_executable_not_command_line_substrings(self):
        app = Path("/Applications/LS 5.15 CLAD.app")
        responses = [
            subprocess.CompletedProcess([], 0, "101\n102\n103\n"),
            subprocess.CompletedProcess([], 0, str(app / "Contents/MacOS/Lens Studio") + "\n"),
            subprocess.CompletedProcess([], 0, "/Applications/Lens Studio.app/Contents/MacOS/Lens Studio\n"),
            subprocess.CompletedProcess([], 0, "/bin/zsh\n"),
        ]
        with patch.object(review.subprocess, "run", side_effect=responses) as run:
            self.assertEqual(review.app_pid(app), 101)
            self.assertEqual(run.call_args_list[0].args[0], ["pgrep", "-x", "Lens Studio"])

    def test_multiple_real_instances_are_not_chosen_arbitrarily(self):
        app = Path("/Applications/LS 5.15 CLAD.app")
        executable = str(app / "Contents/MacOS/Lens Studio")
        with patch.object(review.subprocess, "run", side_effect=[
            subprocess.CompletedProcess([], 0, "101\n102\n"),
            subprocess.CompletedProcess([], 0, executable),
            subprocess.CompletedProcess([], 0, executable),
        ]):
            with self.assertRaises(review.ReviewError):
                review.app_pid(app)


if __name__ == "__main__":
    unittest.main()
