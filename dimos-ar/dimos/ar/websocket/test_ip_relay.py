from __future__ import annotations

import json

import pytest
import requests

from dimos.ar.websocket.ip_relay import IpRelayPublisher


@pytest.mark.parametrize("method,payload,key", [
    ("POST", {"ip": "10.0.0.4", "port": 8787}, None),
    ("PUT", None, "secret"), ("DELETE", None, "secret"),
])
def test_relay_uses_requests_json_auth_and_bounded_timeout(monkeypatch, method, payload, key):
    captured = []

    def request(*args, **kwargs):
        captured.append((args, kwargs))
        response = requests.Response()
        response._content_consumed = True
        response.status_code = 200
        response._content = json.dumps({"pin": "123456", "key": "token"}).encode()
        return response

    monkeypatch.setattr(requests, "request", request)
    publisher = IpRelayPublisher("https://relay.example/", "10.0.0.4", 8787)
    assert publisher._request(method, "/v1/pins", payload, key) == {"pin": "123456", "key": "token"}
    args, kwargs = captured[0]
    assert args == (method, "https://relay.example/v1/pins")
    assert kwargs["json"] == payload
    assert kwargs["timeout"] == 5
    assert kwargs["headers"] == {"User-Agent": "dimos-ar", **({"Authorization": "Bearer secret"} if key else {})}


@pytest.mark.parametrize("status,body,expected", [
    (204, b"", {}), (200, b"[]", None), (200, b"invalid", None),
    (503, b'{"error":"unavailable"}', None),
])
def test_relay_handles_empty_invalid_and_failed_responses(monkeypatch, status, body, expected):
    def request(*_args, **_kwargs):
        response = requests.Response()
        response._content_consumed = True
        response.status_code = status
        response._content = body
        return response

    monkeypatch.setattr(requests, "request", request)
    publisher = IpRelayPublisher("https://relay.example", "10.0.0.4", 8787)
    assert publisher._request("POST", "/v1/pins") == expected


def test_relay_timeout_returns_no_pin(monkeypatch):
    def request(*_args, **_kwargs):
        raise requests.Timeout("deadline")

    monkeypatch.setattr(requests, "request", request)
    publisher = IpRelayPublisher("https://relay.example", "10.0.0.4", 8787)
    assert publisher._create() is False
    assert publisher.pin is None
