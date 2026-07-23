"""Tests for DIMOS_AR_TAG_MOUNTS runtime overrides."""

from __future__ import annotations

import json

import pytest

from dimos.ar.robot_profile.tag_mount_override import (
    ENV_TAG_MOUNTS,
    parse_tag_mounts_json,
    resolve_tag_mounts,
)
from dimos.ar.tag_tracking.solve import TagMount

_DEFAULT = [
    TagMount(
        tag_id=0,
        size_m=0.056,
        position=(0.18, 0.0, 0.06),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
]


def test_resolve_absent_env_returns_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ENV_TAG_MOUNTS, raising=False)
    mounts = resolve_tag_mounts(_DEFAULT)
    assert mounts == list(_DEFAULT)


def test_resolve_override_replaces_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = [
        {
            "tag_id": 1,
            "size_m": 0.056,
            "position": [0.2, 0.0, 0.1],
            "orientation": [0.0, 0.0, 0.0, 1.0],
        }
    ]
    monkeypatch.setenv(ENV_TAG_MOUNTS, json.dumps(payload))
    mounts = resolve_tag_mounts(_DEFAULT)
    assert len(mounts) == 1
    assert mounts[0].tag_id == 1
    assert mounts[0].position == (0.2, 0.0, 0.1)


def test_malformed_json_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(ENV_TAG_MOUNTS, "{not-json")
    with pytest.raises(json.JSONDecodeError):
        resolve_tag_mounts(_DEFAULT)


def test_malformed_shape_raises() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        parse_tag_mounts_json("[]")
    with pytest.raises(ValueError, match="tag_id"):
        parse_tag_mounts_json(json.dumps([{"position": [0, 0, 0]}]))


def test_parse_minimal_mount() -> None:
    mounts = parse_tag_mounts_json(json.dumps([{"tag_id": 0}]))
    assert len(mounts) == 1
    assert mounts[0].tag_id == 0
    assert mounts[0].position == (0.0, 0.0, 0.0)
    assert mounts[0].orientation == (0.0, 0.0, 0.0, 1.0)
    assert mounts[0].size_m == pytest.approx(0.056)
