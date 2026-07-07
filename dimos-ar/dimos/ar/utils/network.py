"""LAN helpers for dimos-ar operator messages."""

from __future__ import annotations

import os
import socket


def detect_lan_ip() -> str | None:
    """Return the LAN IPv4 address Spectacles should use to reach this host."""
    override = os.environ.get("DIMOS_AR_LAN_IP", "").strip()
    if override and override != "unknown":
        return override

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
    except OSError:
        return None

    if not ip or ip.startswith("127."):
        return None
    return str(ip)
