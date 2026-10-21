"""Fingerprint diagnostics need neither a live server nor sensor contents on disk."""

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "diagnose-sensor-codecs.py"
spec = importlib.util.spec_from_file_location("sensor_codec_diagnostics", SCRIPT)
assert spec is not None and spec.loader is not None
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)


def test_fingerprint_match() -> None:
    fingerprint = bytes.fromhex("535cface1f4f5717")
    report = diagnostics.inspect_payload(fingerprint + b"image contents", fingerprint)
    assert report["fingerprint_matches"] is True
    assert report["payload_length"] == 22
    assert "contents" not in str(report)


def test_incompatible_producer_payload() -> None:
    expected = bytes.fromhex("535cface1f4f5717")
    received = bytes.fromhex("f5eb3da1c2853175")
    report = diagnostics.inspect_payload(received + b"data", expected)
    assert report["fingerprint_matches"] is False
    assert report["received_fingerprint"] == received.hex()
    assert report["expected_fingerprint"] == expected.hex()


def test_truncated_header() -> None:
    assert diagnostics.inspect_payload(b"short", b"12345678")["fingerprint_matches"] is False
