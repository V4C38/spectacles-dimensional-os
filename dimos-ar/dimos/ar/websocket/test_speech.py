from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack
from dataclasses import replace
import io
import json
from pathlib import Path
import threading
import tomllib
from types import SimpleNamespace
import wave

from packaging.requirements import Requirement
import pytest
from reactivex import operators as ops
from reactivex.subject import Subject
import websockets

from dimos.ar.robot.capabilities import Capability, CapabilityName
from dimos.ar.websocket.bulk import binary_chunks
from dimos.ar.websocket.speech import LocalSpeechTranscriber, validate_recording
from test_support.websocket import ServerHarness, _sample_hello, _send_hello_request


@pytest.mark.parametrize("request_id,mime,size", [
    ("", "audio/webm", 10), ("x" * 129, "audio/webm", 10),
    ("voice", "video/webm", 10), ("voice", "audio/webm", 2_097_153),
    ("voice", "audio/webm", True),
])
def test_recording_admission_is_bounded(request_id, mime, size):
    with pytest.raises(ValueError):
        validate_recording(request_id, mime, size)


async def test_cancelled_native_transcription_keeps_admission_until_completion():
    entered, release = threading.Event(), threading.Event()

    def transcribe(recording: bytes) -> str:
        assert recording == b"recording"
        entered.set()
        assert release.wait(3)
        return "go home"

    service = LocalSpeechTranscriber(transcribe)
    try:
        task = asyncio.create_task(service.transcribe(b"recording"))
        assert await asyncio.to_thread(entered.wait, 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        with pytest.raises(RuntimeError, match="busy"):
            await service.transcribe(b"recording")
        release.set()
        for _ in range(100):
            if not service._worker._permit.locked():
                break
            await asyncio.sleep(.001)
        assert await service.transcribe(b"recording") == "go home"
    finally:
        release.set()
        service.close()


def test_audio_dependencies_are_declared_and_real_decoder_handles_browser_audio():
    from dimos.stream.audio.decode import decode_audio_bytes

    project = tomllib.loads((Path(__file__).resolve().parents[3] / "pyproject.toml").read_text())["project"]
    dependencies = {Requirement(value).name for value in project["dependencies"]}
    assert {"ffmpeg-python", "soundfile"} <= dependencies
    speech = {Requirement(value).name for value in project["optional-dependencies"]["speech"]}
    assert "faster-whisper" in speech
    data = io.BytesIO()
    with wave.open(data, "wb") as clip:
        clip.setnchannels(1)
        clip.setsampwidth(2)
        clip.setframerate(8000)
        clip.writeframes(bytes(1600))
    audio = decode_audio_bytes(data.getvalue())
    assert audio is not None
    assert audio.sample_rate == 16000
    assert audio.channels == 1
    assert audio.data.ndim == 1
    assert 1500 <= len(audio.data) <= 1700


async def test_lazy_installed_pipeline_prepares_once_and_returns_only_current_text(monkeypatch):
    from dimos.stream.audio import pipeline
    import dimos.stream.audio.decode as decoder

    source = Subject()
    models = []

    def fake_pipeline():
        models.append("loaded")
        return source, source.pipe(ops.map(lambda _audio: " go home "))

    monkeypatch.setattr(pipeline, "whisper_pipeline", fake_pipeline)
    monkeypatch.setattr(decoder, "ffmpeg_requirement", lambda: None)
    monkeypatch.setattr(decoder, "decode_audio_bytes", lambda _raw: SimpleNamespace(
        data=[0] * 160, sample_rate=16000,
    ))
    service = LocalSpeechTranscriber()
    progress = []
    try:
        assert models == []  # No optional STT import/model work on server construction.
        assert await service.transcribe(b"recording", progress.append) == "go home"
        assert await service.transcribe(b"recording", progress.append) == "go home"
        await asyncio.sleep(0)
        assert models == ["loaded"]
        assert progress == ["preparing", "transcribing", "transcribing"]
        assert source.observers == []  # No retained audio/result subscriptions.
    finally:
        service.close()


async def test_decoded_duration_is_bounded_before_loading_a_model(monkeypatch):
    import dimos.stream.audio.decode as decoder

    monkeypatch.setattr(decoder, "ffmpeg_requirement", lambda: None)
    monkeypatch.setattr(decoder, "decode_audio_bytes", lambda _raw: SimpleNamespace(
        data=range(16000 * 30 + 1), sample_rate=16000,
    ))
    service = LocalSpeechTranscriber()
    try:
        with pytest.raises(ValueError, match="30 seconds"):
            await service.transcribe(b"recording")
        assert service._pipeline is None
    finally:
        service.close()


async def test_bulk_dictation_returns_a_draft_while_control_remains_responsive():
    entered, release, stopped = threading.Event(), threading.Event(), threading.Event()
    commands = []
    harness = ServerHarness(
        on_user_message_request=lambda *args: commands.append(args),
        on_estop_request=lambda *_args: stopped.set(),
    )
    harness.start()
    server = harness._server
    assert server is not None
    body = _sample_hello("unused")
    server._hello_supplier = lambda _client: replace(body, capabilities={
        **body.capabilities, CapabilityName.AGENT: Capability(True, None),
    })

    def transcribe(recording: bytes) -> str:
        assert recording == b"recording"
        entered.set()
        assert release.wait(3)
        return "go home"

    server._speech._transcribe = transcribe
    try:
        async with AsyncExitStack() as stack:
            control = await stack.enter_async_context(websockets.connect(
                f"ws://127.0.0.1:{harness.port}/ws"
            ))
            hello = await _send_hello_request(control)
            assert hello["speech_transcription"] is True
            bulk = await stack.enter_async_context(websockets.connect(
                f"ws://127.0.0.1:{harness.port}{hello['bulk_url']}"
            ))
            await bulk.send(json.dumps({
                "type": "bulk_hello_request", "protocol_version": 2,
                "client_id": hello["client_id"], "token": hello["bulk_token"],
            }))
            assert json.loads(await bulk.recv())["type"] == "bulk_hello"
            await bulk.send(json.dumps({
                "type": "bulk_upload_begin", "kind": "speech", "upload_id": 3,
                "total_bytes": 9, "request_id": "speech-one", "mime_type": "audio/webm;codecs=opus",
            }))
            assert json.loads(await bulk.recv())["type"] == "bulk_upload_ready"
            for chunk in binary_chunks(3, b"recording"):
                await bulk.send(chunk)
            assert json.loads(await bulk.recv())["status"] == "accepted"
            assert await asyncio.to_thread(entered.wait, 1)
            await control.send(json.dumps({"type": "estop_request"}))
            assert await asyncio.to_thread(stopped.wait, 1)
            release.set()
            result = json.loads(await asyncio.wait_for(control.recv(), 2))
            assert result == {"type": "speech_transcription_result", "request_id": "speech-one",
                              "status": "completed", "text": "go home"}
            assert commands == []
    finally:
        release.set()
        harness.stop()


async def test_non_agent_hello_does_not_advertise_dictation():
    harness = ServerHarness()
    harness.start()
    try:
        async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as control:
            hello = await _send_hello_request(control)
            assert hello["speech_transcription"] is False
    finally:
        harness.stop()


async def test_missing_local_backend_is_not_advertised_or_admitted(monkeypatch):
    from dimos.ar.websocket import speech

    monkeypatch.setattr(speech.shutil, "which", lambda _tool: "/test/bin/ffmpeg")
    monkeypatch.setattr(speech, "find_spec", lambda module:
                        None if module in {"whisper", "faster_whisper"} else object())
    harness = ServerHarness()
    harness.start()
    server = harness._server
    assert server is not None
    body = _sample_hello("unused")
    server._hello_supplier = lambda _client: replace(body, capabilities={
        **body.capabilities, CapabilityName.AGENT: Capability(True, None),
    })
    try:
        async with AsyncExitStack() as stack:
            control = await stack.enter_async_context(websockets.connect(
                f"ws://127.0.0.1:{harness.port}/ws"
            ))
            hello = await _send_hello_request(control)
            assert hello["speech_transcription"] is False
            assert "dimos-ar[speech]" in hello["speech_transcription_reason"]
            bulk = await stack.enter_async_context(websockets.connect(
                f"ws://127.0.0.1:{harness.port}{hello['bulk_url']}"
            ))
            await bulk.send(json.dumps({
                "type": "bulk_hello_request", "protocol_version": 2,
                "client_id": hello["client_id"], "token": hello["bulk_token"],
            }))
            assert json.loads(await bulk.recv())["type"] == "bulk_hello"
            await bulk.send(json.dumps({
                "type": "bulk_upload_begin", "kind": "speech", "upload_id": 3,
                "total_bytes": 9, "request_id": "speech-one", "mime_type": "audio/webm",
            }))
            rejected = json.loads(await bulk.recv())
            assert rejected["status"] == "rejected"
            assert rejected["code"] == "speech_unavailable"
            assert server._speech_tasks == {}
            assert server._speech._pipeline is None
    finally:
        harness.stop()
