"""Publish this machine's LAN address to the IP relay and hold a six-digit PIN."""

from __future__ import annotations

import socket
import threading
from typing import Any, cast

import requests

from dimos.utils.logging_config import setup_logger

DEFAULT_IP_RELAY_URL = "https://spectacles-ip-relay.johannestscharn.workers.dev"

_REFRESH_SECONDS = 30

logger = setup_logger()


def lan_ip() -> str | None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()
    if not isinstance(ip, str) or not ip or ip.startswith("127."):
        return None
    return ip


class IpRelayPublisher:
    """Register, refresh, and delete one PIN record."""

    def __init__(self, relay_url: str, ip: str, port: int) -> None:
        self.relay_url = relay_url.rstrip("/")
        self.ip = ip
        self.port = port
        self.pin: str | None = None
        self._key: str | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="ip-relay", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=0.1 if self.pin is None else 6)
        self._delete()
        self.pin = None

    def _run(self) -> None:
        if self._stop.is_set() or not self._create():
            logger.warning("PIN unavailable, enter IP")
            return
        if self._stop.is_set():
            self._delete()
            return
        logger.info(f"PIN: {self.pin}")
        while not self._stop.wait(_REFRESH_SECONDS):
            if self._refresh():
                continue
            self.pin = None
            if self._stop.is_set() or not self._create():
                logger.warning("PIN unavailable, enter IP")
                return
            if self._stop.is_set():
                self._delete()
                return
            logger.info(f"PIN: {self.pin}")

    def _create(self) -> bool:
        body = self._request("POST", "/v1/pins", {"ip": self.ip, "port": self.port})
        if not body or "pin" not in body or "key" not in body:
            return False
        self.pin = str(body["pin"])
        self._key = str(body["key"])
        return True

    def _refresh(self) -> bool:
        if self.pin is None or self._key is None:
            return False
        body = self._request("PUT", f"/v1/pins/{self.pin}", key=self._key)
        return body is not None

    def _delete(self) -> None:
        if self.pin is None or self._key is None:
            return
        self._request("DELETE", f"/v1/pins/{self.pin}", key=self._key)
        self._key = None

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        key: str | None = None,
    ) -> dict[str, Any] | None:
        headers = {"User-Agent": "dimos-ar"}
        if key is not None:
            headers["Authorization"] = "Bearer " + key
        try:
            with requests.request(
                method, self.relay_url + path, json=payload, headers=headers, timeout=5
            ) as response:
                response.raise_for_status()
                if not response.content:
                    return {}
                parsed = response.json()
                if not isinstance(parsed, dict):
                    return None
                return cast("dict[str, Any]", parsed)
        except (requests.RequestException, ValueError) as exc:
            logger.warning("IP relay request failed", method=method, path=path, error=str(exc))
            return None
