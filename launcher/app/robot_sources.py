"""Resolve explicit launcher source choices before starting child processes."""

import ipaddress
import json
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field


@dataclass(frozen=True)
class BlueprintDefinition:
    id: str
    robot: Literal["unitree_go2", "openyam"]
    cli: str
    description: str
    agent: bool = False
    manipulation: bool = False

    @property
    def label(self) -> str:
        return self.cli.removeprefix("dimos-ar.")


# This order is also the launcher menu order. Consumers derive facts from here.
BLUEPRINTS = {
    item.id: item for item in (
        BlueprintDefinition(
            "unitree_go2_ar", "unitree_go2", "dimos-ar.unitree-go2-ar",
            "Unitree Go2 with ARModule\nManual Mode: place navigation goals from the headset.",
        ),
        BlueprintDefinition(
            "unitree_go2_ar_agentic", "unitree_go2", "dimos-ar.unitree-go2-ar-agentic",
            "Unitree Go2 with ARModule\nManual Mode: place navigation goals from the headset."
            "\nAgent Mode: voice commands via LLM and MCP (API key required)",
            agent=True,
        ),
        BlueprintDefinition(
            "openyam_ar_planner", "openyam", "dimos-ar.openyam-ar-planner",
            "OpenYAM · manipulation: plan/review/execute or grab the end effector to follow.",
            manipulation=True,
        ),
    )
}
BLUEPRINT_CLI = {key: item.cli for key, item in BLUEPRINTS.items()}


def blueprint_definition(blueprint: str) -> BlueprintDefinition:
    try:
        return BLUEPRINTS[blueprint]
    except KeyError as exc:
        raise ValueError("Unknown robot blueprint") from exc


def blueprint_metadata() -> list[dict[str, Any]]:
    return [{**asdict(item), "label": item.label} for item in BLUEPRINTS.values()]


class SourceBody(BaseModel):
    model_config = {"extra": "forbid"}

    mode: Literal["auto", "device", "manual", "simulated"]
    device_id: str | None = None
    address: str | None = None
    replay: str | None = None
    playback: Literal["simulator", "recording"] = "simulator"
    streams: dict[str, str] = Field(default_factory=dict)


class SourceSelectionRequired(ValueError):
    def __init__(self, devices: list[dict[str, Any]], *, automatic: bool) -> None:
        if devices:
            message = "Choose a robot"
        elif automatic:
            message = "No devices found; connect the device and retry Auto, or explicitly choose Simulate hardware"
        else:
            message = "Selected device unavailable; refresh or choose another connection"
        super().__init__(message)
        self.devices = devices
        self.suggest_simulated = False


@dataclass(frozen=True)
class ResolvedRobotSource:
    robot_ip: str | None = None
    can_port: str | None = None
    simulation: bool = False
    replay: str | None = None

    def cli_arguments(self, blueprint: str) -> tuple[str, ...]:
        definition = blueprint_definition(blueprint)
        if definition.manipulation:
            if self.replay:
                return ("run", "dimos-ar.openyam-ar-replay")
            if self.simulation:
                return ("--simulation=mock", "run", BLUEPRINT_CLI[blueprint])
        elif self.robot_ip == "simulated":
            return ("run", "dimos-ar.unitree-go2-ar-replay")
        return ("run", BLUEPRINT_CLI[blueprint])


def resolve_robot_source(
    robot: Literal["unitree_go2", "openyam"],
    source: SourceBody,
    devices: list[dict[str, Any]] | None = None,
) -> ResolvedRobotSource:
    devices = devices or []
    if source.mode in {"auto", "device"}:
        choices = devices if source.mode == "auto" else [d for d in devices if d["id"] == source.device_id]
        if len(choices) != 1:
            raise SourceSelectionRequired(choices, automatic=source.mode == "auto")
        address = choices[0]["address"]
        return ResolvedRobotSource(can_port=address) if robot == "openyam" else ResolvedRobotSource(robot_ip=address)
    if source.mode == "manual":
        if robot != "unitree_go2" or not source.address:
            raise ValueError("Manual IP requires a Go2 address")
        try:
            return ResolvedRobotSource(robot_ip=str(ipaddress.IPv4Address(source.address.strip())))
        except ipaddress.AddressValueError as exc:
            raise ValueError("Enter a valid Go2 IPv4 address") from exc
    replay = source.replay
    if robot == "openyam":
        if source.playback == "recording" and not replay:
            raise ValueError("Choose an OpenYAM recording")
        if source.playback == "simulator":
            replay = None
    if replay:
        path = Path(replay).expanduser()
        if path.suffix != ".db" or not path.is_file():
            raise ValueError("Choose an existing .db replay")
        replay = str(path.resolve())
    return ResolvedRobotSource(
        robot_ip="simulated" if robot == "unitree_go2" else None,
        simulation=robot == "openyam",
        replay=replay,
    )


if __name__ == "__main__":
    if sys.argv[1] == "--metadata":
        print(json.dumps(blueprint_metadata()))
        raise SystemExit(0)
    if sys.argv[1] == "--menu":
        for definition in BLUEPRINTS.values():
            print(f"{definition.id}\t{definition.label}\t{int(definition.manipulation)}")
        raise SystemExit(0)
    source = ResolvedRobotSource(
        robot_ip="simulated" if sys.argv[2] == "1" else None,
        simulation=os.environ.get("DIMOS_AR_SIMULATION") == "1",
        replay=os.environ.get("REPLAY_DB") or None,
    )
    print("\n".join(source.cli_arguments(sys.argv[1])))
