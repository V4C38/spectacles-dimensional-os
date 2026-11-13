"""Own one recorder process from startup proof through bounded finalization."""
from __future__ import annotations
import asyncio
import contextlib
import json
from pathlib import Path
from review_evidence import ReviewError, ReviewEvents


class NativeRecording:
    def __init__(self, binary: Path, pid: int, directory: Path, duration: float, focus: Path) -> None:
        self.command = [str(binary), str(pid), str(directory / "recording.mp4"), str(duration),
                        str(directory / "recording.stop"), str(focus)]
        self.directory = directory
        self.process: asyncio.subprocess.Process | None = None
        self.ready: dict = {}
        self._log = None

    async def __aenter__(self) -> NativeRecording:
        self._log = (self.directory / "recorder.log").open("wb")
        try:
            self.process = await asyncio.create_subprocess_exec(
                *self.command, stdout=self._log, stderr=self._log)
            ready = self.directory / "recording.ready.json"
            deadline = asyncio.get_running_loop().time() + 20
            while asyncio.get_running_loop().time() < deadline:
                if ready.is_file():
                    self.ready = json.loads(ready.read_text())
                    return self
                if self.process.returncode is not None:
                    raise ReviewError("Recorder exited before recording started; see recorder.log")
                await asyncio.sleep(0.1)
            raise ReviewError("Recorder did not report a start time; see recorder.log")
        except BaseException:
            await self.__aexit__(None, None, None)
            raise

    async def finish(self, completed: bool) -> None:
        assert self.process is not None
        if completed and self.process.returncode is None:
            await asyncio.sleep(1)
            (self.directory / "recording.stop").touch()
        try:
            await asyncio.wait_for(self.process.wait(), 15)
        except asyncio.TimeoutError as error:
            raise ReviewError("Recorder did not finalize continuous video; see recorder.log") from error
        if self.process.returncode != 0:
            raise ReviewError("Recorder failed; see recorder.log")

    async def __aexit__(self, *_args) -> None:
        if self.process is not None and self.process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), 5)
            except asyncio.TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    self.process.kill()
                await self.process.wait()
        if self._log is not None:
            self._log.close()


class CaptureSession:
    """One recorder and its incremental native log/event stream share a lifetime."""

    def __init__(self, binary: Path, pid: int, output: Path, duration: float,
                 focus: Path, logfile: Path) -> None:
        self.recording = NativeRecording(binary, pid, output / "diagnostics", duration, focus)
        self.output = output
        self.logfile = logfile
        self.offset = logfile.stat().st_size
        self.collected = ReviewEvents()

    @property
    def process(self) -> asyncio.subprocess.Process | None:
        return self.recording.process

    @property
    def ready(self) -> dict:
        return self.recording.ready

    async def __aenter__(self) -> CaptureSession:
        await self.recording.__aenter__()
        return self

    async def __aexit__(self, *args) -> None:
        await self.recording.__aexit__(*args)

    async def finish(self, completed: bool) -> None:
        await self.recording.finish(completed)

    def poll(self) -> list[dict]:
        if not self.logfile.is_file():
            return []
        if self.logfile.stat().st_size < self.offset:
            self.offset = 0
        with self.logfile.open("rb") as stream:
            stream.seek(self.offset)
            chunk = stream.read()
            self.offset = stream.tell()
        if not chunk:
            return []
        # Keep failure bytes even when decoding raises, before writing event state.
        with (self.output / "native.log").open("ab") as copy:
            copy.write(chunk)
        fresh = self.collected.feed(chunk)
        (self.output / "events.json").write_text(json.dumps(self.collected.events, indent=2) + "\n")
        return fresh
