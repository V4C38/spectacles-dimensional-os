#!/usr/bin/env python3
"""Discover Unitree robots on the local network.

Uses DimOS's official LAN discovery (``dimos.robot.unitree.go2.cli.landiscovery``)
— the same multicast probe the DimOS CLI uses, which pins the probe to real
interfaces so VPN/tunnel routes don't swallow it. Prints one ``serial<TAB>ip``
line per discovered robot on stdout so callers (e.g. ``start.sh``) can parse the
results; human-readable progress is left to stderr.

Usage:
    discover_robot.py [timeout_seconds]
"""

from __future__ import annotations

import sys

from dimos.robot.unitree.go2.cli.landiscovery import discover


def main() -> int:
    timeout = 2.0
    if len(sys.argv) > 1:
        try:
            timeout = float(sys.argv[1])
        except ValueError:
            print(f"Invalid timeout: {sys.argv[1]!r}", file=sys.stderr)
            return 2

    try:
        devices = discover(timeout=timeout)
    except OSError as exc:
        print(f"Robot discovery failed: {exc}", file=sys.stderr)
        return 2

    for device in devices:
        print(f"{device.serial}\t{device.ip}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
