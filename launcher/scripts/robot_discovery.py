"""Non-actuating robot transport discovery shared by launcher and start.sh."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from typing import Any


def discover(robot: str) -> list[dict[str, Any]]:
    if robot == "unitree_go2":
        from dimos.robot.unitree.go2.cli.landiscovery import discover as discover_go2

        return [dict(id=d.serial, label=f"{d.serial} · {d.ip}", address=d.ip, transport="lan") for d in discover_go2(timeout=2.0)]
    if robot != "openyam":
        raise ValueError("Unknown robot type")
    if sys.platform == "linux":
        process = subprocess.run(["ip", "-json", "link", "show", "type", "can"], capture_output=True, text=True, check=True, timeout=3)
        return [dict(id=d["ifname"], label="CAN · " + d["ifname"], address=d["ifname"], transport="can") for d in json.loads(process.stdout)]
    if sys.platform == "darwin":
        import can_motor_control

        devices = can_motor_control.list_gs_usb_devices(vendor_id=0x1D50, product_id=0x606F)
        return [dict(id=d.serial_number, label="USB CAN · " + d.serial_number, address=d.serial_number, transport="can") for d in devices if d.serial_number]
    raise RuntimeError("CAN discovery unsupported on this platform")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("robot", choices=("unitree_go2", "openyam"))
    parser.add_argument("--format", choices=("json", "tsv"), default="json")
    args = parser.parse_args()
    devices = discover(args.robot)
    if args.format == "tsv":
        for device in devices:
            print(f"{device['id']}\t{device['address']}")
    else:
        print(json.dumps(devices))


if __name__ == "__main__":
    main()
