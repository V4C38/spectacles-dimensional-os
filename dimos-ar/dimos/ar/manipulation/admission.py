from __future__ import annotations

from dataclasses import replace
import math
import time
from typing import Any

from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.replication.interaction import InteractionCoordinator


def admit_manipulation(
    request: ManipulationRequest, client_id: str, interaction: InteractionCoordinator
) -> ManipulationRequest | dict[str, Any]:
    payload = request.payload
    authority = interaction.authority
    epoch = payload.get("epoch")
    lease_id = payload.get("lease_id")
    owns = (
        authority is not None
        and authority.client_id == client_id
        and authority.lease_id == lease_id
        and authority.kind.startswith("manipulation_")
        and authority.group_id == request.group_id
    )
    # Discrete commands can use a released shared target; they do not acquire
    # a persistent creator-client lock. Native operation admission stays atomic.
    target = interaction.target_for("manipulation", request.group_id)
    valid_target = target is not None and payload.get("target_revision") == target.revision
    allowed = (
        epoch == interaction.epoch
        and interaction.mode == "manual"
        and (owns or authority is None)
    )
    if request.action in {"acquire", "update"}:
        allowed = (
            allowed
            and owns
            and authority is not None
            and authority.kind == "manipulation_following"
        )
    elif request.action == "evaluate":
        allowed = allowed and owns and target is not None
    elif request.action in {"plan", "execute"}:
        allowed = allowed and valid_target
    elif request.action == "gripper":
        allowed = allowed and owns
    if not allowed:
        return {"status": "rejected", "code": "ownership",
                "message": "Robot interaction is owned or target changed"}
    advisory_current = False
    if request.action == "evaluate" and target is not None:
        advisory_current = bool(
            math.dist(payload["position"], target.position) < 1e-6
            and abs(sum(a * b for a, b in zip(
                payload["orientation"], target.orientation, strict=True
            ))) > 1 - 1e-10
        )
    if request.action in {"update", "plan"} and target is not None:
        payload = {
            **payload,
            "position": list(target.position),
            "orientation": list(target.orientation),
            "speed_scale": target.speed_scale,
        }
        payload.pop("final_gripper", None)
        if request.action == "plan" and target.gripper is not None:
            payload["final_gripper"] = target.gripper
    if request.action == "cancel":
        interaction.cancel_manipulation_target(request.group_id)
    trusted = {
        **payload,
        "authority_epoch": interaction.epoch,
        "authority_lease": authority.lease_id if owns and authority is not None else None,
        "authority_revision": interaction.revision,
        "authority_deadline": authority.expires_at
        if request.action != "cancel" and owns and authority is not None
        else time.monotonic() + 0.5,
        "target_revision": target.revision if target is not None else 0,
    }
    if request.action == "evaluate":
        trusted["advisory_target_revision"] = (
            target.revision if advisory_current and target is not None
            else payload.get("target_revision")
        )
        trusted["advisory_current"] = advisory_current
    if request.action in {"execute", "reset_joints", "prepare_shutdown", "cancel"}:
        if request.action != "cancel" and interaction.motion_busy:
            return {"status": "rejected", "code": "busy"}
        if request.action == "reset_joints":
            interaction.clear_manipulation_target(request.group_id)
            trusted["authority_revision"] = interaction.revision
        interaction.begin_manipulation_motion(request.request_id)
        trusted["authority_revision"] = interaction.revision
    return replace(request, payload=trusted)
