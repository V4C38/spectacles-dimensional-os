"""Bounded draft-only dictation using DimOS's installed audio pipeline."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from importlib.util import find_spec
import shutil
from typing import Any

from dimos.ar.async_execution import BoundedWorker

SPEECH_MAX_BYTES = 2_097_152
SPEECH_MIME_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/wav"}


def validate_recording(request_id: object, mime_type: object, size: object) -> tuple[str, str]:
    if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
        raise ValueError("invalid transcription request id")
    if (not isinstance(mime_type, str) or len(mime_type) > 128
            or mime_type.split(";", 1)[0] not in SPEECH_MIME_TYPES):
        raise ValueError("unsupported recording format")
    if type(size) is not int or not 6 <= size <= SPEECH_MAX_BYTES:
        raise ValueError("recording exceeds the 2 MiB limit")
    return request_id, mime_type


class LocalSpeechTranscriber:
    """One lazy model, one native operation, no audio or transcript history."""

    def __init__(self, transcribe: Callable[[bytes], str] | None = None) -> None:
        self._worker = BoundedWorker("ar-dictation")
        self._transcribe = transcribe
        self._pipeline: tuple[Any, Any] | None = None

    def availability_error(self) -> str | None:
        if self._transcribe is not None:
            return None
        if shutil.which("ffmpeg") is None:
            return "Install ffmpeg on the DimOS server, then reconnect to use local dictation."
        if any(find_spec(module) is None for module in ("ffmpeg", "soundfile")):
            return "Local dictation audio dependencies are missing. Reinstall dimos-ar in the selected DimOS environment, then reconnect."
        if find_spec("faster_whisper") is None and find_spec("whisper") is None:
            return "Local dictation needs dimos-ar[speech] in the selected DimOS environment. Install the speech extra, then reconnect."
        return None

    def _local_transcribe(self, recording: bytes, progress: Callable[[str], None]) -> str:
        # These are the same decoder and normalize -> Whisper chain used by
        # installed DimOS VoiceInput. Never publish to its human_input stream:
        # only the client can submit the returned draft with explicit Send.
        from dimos.stream.audio.decode import decode_audio_bytes, ffmpeg_requirement
        from dimos.stream.audio.pipeline import whisper_pipeline

        requirement = ffmpeg_requirement()
        if requirement:
            raise RuntimeError(requirement)
        audio = decode_audio_bytes(recording)
        if audio is None:
            raise ValueError("The recording could not be decoded. Try recording again.")
        if len(audio.data) > audio.sample_rate * 30:
            raise ValueError("Recordings must be shorter than 30 seconds.")
        if self._pipeline is None:
            progress("preparing")
            self._pipeline = whisper_pipeline()
        progress("transcribing")
        source, output = self._pipeline
        text: list[str] = []
        subscription = output.subscribe(text.append)
        try:
            source.on_next(audio)
        finally:
            subscription.dispose()
        result = " ".join(text).strip()
        if not result:
            raise ValueError("No speech was heard. Try recording again.")
        return result[:2000]

    async def transcribe(
        self, recording: bytes, progress: Callable[[str], None] = lambda _status: None
    ) -> str:
        if not 6 <= len(recording) <= SPEECH_MAX_BYTES:
            raise ValueError("recording exceeds the 2 MiB limit")
        loop = asyncio.get_running_loop()

        def notify(status: str) -> None:
            if not loop.is_closed():
                loop.call_soon_threadsafe(progress, status)

        def work() -> str:
            if self._transcribe is not None:
                return self._transcribe(recording)
            return self._local_transcribe(recording, notify)

        # Loading the installed model (including its normal first-use cache
        # preparation) has a separate, longer allowance than transcription.
        timeout = 180 if self._pipeline is None and self._transcribe is None else 45
        async with asyncio.timeout(timeout):
            result = await self._worker.run_if_idle(work)
        if result is None:
            raise RuntimeError("Dictation is busy. Try recording again shortly.")
        return result[:2000]

    def close(self) -> None:
        self._worker.close()
