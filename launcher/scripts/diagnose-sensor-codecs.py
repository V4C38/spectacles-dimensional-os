#!/usr/bin/env python3
"""Inspect sensor schema fingerprints without publishing or saving sensor contents."""

from __future__ import annotations

import argparse
from collections import Counter
import importlib
import json
from pathlib import Path
import threading
import time
from typing import Any

SENSOR_TYPES = ("Image", "PointCloud2")


def inspect_payload(payload: bytes, expected: bytes) -> dict[str, Any]:
    received = payload[:8]
    return {
        "payload_length": len(payload),
        "received_fingerprint": received.hex(),
        "expected_fingerprint": expected.hex(),
        "fingerprint_matches": len(received) == 8 and received == expected,
    }


def load_codec(name: str) -> type:
    module = importlib.import_module(f"dimos_lcm.sensor_msgs.{name}")
    return getattr(module, name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--payload", type=Path, help="Offline LCM payload to decode")
    source.add_argument("--endpoint", help="Explicit Zenoh TCP endpoint for passive observation")
    parser.add_argument("--message-type", choices=SENSOR_TYPES, default="Image")
    parser.add_argument("--seconds", type=float, default=5)
    args = parser.parse_args()
    if not 0 < args.seconds <= 30:
        parser.error("--seconds must be greater than zero and at most 30")
    codecs = {name: load_codec(name) for name in SENSOR_TYPES}
    expected = {name: codec._get_packed_fingerprint() for name, codec in codecs.items()}
    if args.payload:
        payload = args.payload.read_bytes()
        report = inspect_payload(payload, expected[args.message_type])
        report["message_type"] = args.message_type
        try:
            codecs[args.message_type].lcm_decode(payload)
            report["decodes"] = True
        except Exception as error:
            report.update(decodes=False, decode_error=f"{type(error).__name__}: {error}")
        print(json.dumps(report, indent=2))
        return 0 if report["decodes"] else 1

    import zenoh

    config = zenoh.Config()
    config.insert_json5("mode", '"client"')
    config.insert_json5("connect/endpoints", json.dumps([args.endpoint]))
    config.insert_json5("scouting/multicast/enabled", "false")
    counts: Counter[str] = Counter()
    lock = threading.Lock()
    sample_count = 0

    def observe(sample: Any) -> None:
        nonlocal sample_count
        with lock:
            if sample_count >= 100:
                return
            sample_count += 1
            topic = str(sample.key_expr)
            name = topic.rsplit(".", 1)[-1]
            report = inspect_payload(sample.payload.to_bytes(), expected[name])
            report["topic"] = topic
            source_info = getattr(sample, "source_info", None)
            if source_info is not None:
                report["source_info"] = str(source_info)[:256]
            counts[json.dumps(report, sort_keys=True)] += 1

    with zenoh.open(config) as session:
        subscribers = [
            session.declare_subscriber(f"**/sensor_msgs.{name}", observe)
            for name in SENSOR_TYPES
        ]
        time.sleep(args.seconds)
        for subscriber in subscribers:
            subscriber.undeclare()
    print(json.dumps({
        "expected": {name: value.hex() for name, value in expected.items()},
        "samples": [{**json.loads(key), "count": count} for key, count in counts.items()],
    }, indent=2))
    return 0 if sample_count else 2


if __name__ == "__main__":
    raise SystemExit(main())
