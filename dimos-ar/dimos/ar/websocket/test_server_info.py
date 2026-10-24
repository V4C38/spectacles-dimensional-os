from importlib.metadata import PackageNotFoundError
from types import SimpleNamespace

import pytest

from dimos.ar.websocket import server_info as metadata


def test_effective_robot_and_package_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(metadata, "global_config", SimpleNamespace(
        replay=False, simulation=False, robot_ip="10.0.0.42"
    ))
    monkeypatch.setattr(metadata, "version", lambda name: {"dimos": "0.4.0", "dimos-ar": "0.2.0"}[name])
    assert metadata.server_info() == {
        "robot_ip": "10.0.0.42", "dimos_version": "0.4.0", "armodule_version": "0.2.0"
    }


def test_unavailable_versions_and_replay(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing(_name: str) -> str:
        raise PackageNotFoundError

    monkeypatch.setattr(metadata, "version", missing)
    monkeypatch.setattr(metadata, "global_config", SimpleNamespace(
        replay=True, simulation=False, robot_ip=None
    ))
    assert metadata.server_info() == {"robot_ip": "Simulated"}
    monkeypatch.setattr(metadata, "global_config", SimpleNamespace(
        replay=False, simulation=False, robot_ip=None
    ))
    assert metadata.server_info() == {}
