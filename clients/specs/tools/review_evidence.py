"""Native log decoding and checkpoint evidence; no editor or process effects."""
from __future__ import annotations
import json
import math
import re
from typing import Any

EVENT_PREFIX = "SPECS_REVIEW "

class ReviewError(RuntimeError):
    """A review could not produce trustworthy artifacts."""


def parse_events(text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    decoder = json.JSONDecoder()
    for line in text.splitlines():
        if EVENT_PREFIX not in line:
            continue
        payload = line.split(EVENT_PREFIX, 1)[1]
        try:
            event, _ = decoder.raw_decode(payload.lstrip())
        except ValueError:
            continue
        if isinstance(event, dict) and event.get("type") in {"scene", "result", "complete", "host"}:
            events.append(event)
    return events


def runtime_error_lines(text: str) -> list[str]:
    """SIK's dispatcher catches script errors and prints them at Info level."""
    return list(dict.fromkeys(
        line for line in text.splitlines()
        if (line.startswith(("E ", "F ")) and re.search(
            r"(?:InternalError|TypeError|ReferenceError|RangeError|SyntaxError|Error):", line,
        )) or "UpdateDispatcher: Error in event" in line
    ))


def checkpoint(event: dict[str, Any], recording_started_ms: float,
               previous: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    name, unix_ms = event.get("name"), event.get("unixMs")
    if not isinstance(name, str) or not name.strip():
        raise ReviewError("A scene checkpoint is missing its name")
    if previous and any(scene["name"] == name for scene in previous):
        raise ReviewError(f"Native scenario restarted at {name!r}; rerun after compilation settles")
    if isinstance(unix_ms, bool) or not isinstance(unix_ms, (int, float)) or not math.isfinite(unix_ms):
        raise ReviewError(f"Checkpoint {name!r} is missing a finite unixMs timestamp")
    at = (unix_ms - recording_started_ms) / 1000
    if at < 0:
        raise ReviewError(f"Checkpoint {name!r} occurred before continuous recording started")
    # Native checkpoints announce the start of an action. Browser checkpoints
    # announce completed actions and use the shared renderer's usual lead-in.
    return {
        "name": name, "at": at, "unixMs": unix_ms, "leadInS": 0,
        "durationS": 1.4 if name in {"navigation-stop", "navigation-success", "navigation-cancelled"} else 2.8,
        "videoOnly": event.get("videoOnly") is True,
    }



class ReviewEvents:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self.completion: dict[str, Any] | None = None
        self._seen: set[str] = set()
        self._partial = ""

    def feed(self, chunk: bytes) -> list[dict[str, Any]]:
        text = self._partial + chunk.decode("utf-8", errors="replace")
        if runtime_error_lines(text):
            raise ReviewError("Native Preview stopped with a runtime error; see native.log")
        lines = text.split("\n")
        self._partial = lines.pop()
        fresh = []
        for event in parse_events("\n".join(lines)):
            key = json.dumps(event, sort_keys=True)
            if key in self._seen:
                continue
            self._seen.add(key)
            self.events.append(event)
            fresh.append(event)
            if event["type"] == "complete":
                self.completion = event
        return fresh
