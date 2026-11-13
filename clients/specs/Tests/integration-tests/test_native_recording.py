from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
from native_recording import NativeRecording
from review_evidence import ReviewError, ReviewEvents


class RecorderTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_start_reaps_recorder_and_closes_log(self) -> None:
        process = AsyncMock()
        process.returncode = 1
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            recorder = NativeRecording(Path("recorder"), 123, root, 60, root / "focus")
            with patch("native_recording.asyncio.create_subprocess_exec", return_value=process):
                with self.assertRaisesRegex(ReviewError, "before recording started"):
                    async with recorder:
                        self.fail("startup must fail")
            self.assertTrue(recorder._log.closed)

    async def test_context_interruption_terminates_and_reaps_process(self) -> None:
        class Process:
            returncode = None
            terminated = False

            def terminate(self):
                self.terminated = True
                self.returncode = -15

            async def wait(self):
                return self.returncode

        process = Process()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "recording.ready.json").write_text(json.dumps({"startedAt": 42}))
            recorder = NativeRecording(Path("recorder"), 123, root, 60, root / "focus")
            with patch("native_recording.asyncio.create_subprocess_exec", return_value=process):
                with self.assertRaises(asyncio.CancelledError):
                    async with recorder:
                        self.assertEqual(recorder.ready["startedAt"], 42)
                        raise asyncio.CancelledError()
            self.assertTrue(process.terminated)
            self.assertTrue(recorder._log.closed)


class NativeEventsTests(unittest.TestCase):
    def test_fragmented_native_events_are_deduplicated_and_completion_retained(self) -> None:
        events = ReviewEvents()
        self.assertEqual(events.feed(b'I SPECS_REVIEW {"type":"res'), [])
        received = events.feed(b'ult","name":"check","passed":true}\n')
        self.assertEqual(len(received), 1)
        self.assertEqual(events.feed(b'I SPECS_REVIEW {"type":"result","name":"check","passed":true}\n'), [])
        events.feed(b'I SPECS_REVIEW {"type":"complete","passed":true}\n')
        self.assertTrue(events.completion["passed"])
        self.assertEqual(len(events.events), 2)

    def test_split_runtime_error_cannot_be_hidden_at_chunk_boundary(self) -> None:
        events = ReviewEvents()
        events.feed(b'I UpdateDispatcher: Er')
        with self.assertRaisesRegex(ReviewError, "runtime error"):
            events.feed(b'ror in event "frame": Error: failed\n')


class CaptureSessionTests(unittest.TestCase):
    def test_poll_retains_partial_events_and_handles_log_truncation(self):
        from native_recording import CaptureSession
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            logfile = root / "editor.log"
            logfile.write_bytes(b"old project\n")
            session = CaptureSession(Path("recorder"), 1, root, 60, root / "focus", logfile)
            with logfile.open("ab") as stream:
                stream.write(b'I SPECS_REVIEW {"type":"res')
            self.assertEqual(session.poll(), [])
            with logfile.open("ab") as stream:
                stream.write(b'ult","passed":true}\n')
            self.assertEqual(session.poll(), [{"type": "result", "passed": True}])
            logfile.write_bytes(b'I SPECS_REVIEW {"type":"complete","passed":true}\n')
            session.poll()
            self.assertTrue(session.collected.completion["passed"])
            self.assertNotIn(b"old project", (root / "native.log").read_bytes())
            self.assertEqual(len(json.loads((root / "events.json").read_text())), 2)

    def test_runtime_failure_bytes_are_retained_before_decode_raises(self):
        from native_recording import CaptureSession
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            logfile = root / "editor.log"
            logfile.touch()
            session = CaptureSession(Path("recorder"), 1, root, 60, root / "focus", logfile)
            failure = b'E TypeError: failed rendering\n'
            logfile.write_bytes(failure)
            with self.assertRaisesRegex(ReviewError, "runtime error"):
                session.poll()
            self.assertEqual((root / "native.log").read_bytes(), failure)
