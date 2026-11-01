from dataclasses import replace

import pytest

from dimos.ar.replication.interaction import InteractionCoordinator, InteractionRequest
from dimos.ar.replication.protocol import decode_interaction_request


@pytest.fixture
def fixture():
    now = [100.0]
    owner = InteractionCoordinator(clock=lambda: now[0])
    for client in ("a", "b", "c"):
        owner.connect(client)
    return owner, now


def acquire(owner, client="a", kind="live", identity="grab", **kwargs):
    return owner.handle(
        client,
        InteractionRequest(
            identity,
            "acquire",
            owner.epoch,
            acquisition_id=identity,
            source_id="right",
            kind=kind,
            **kwargs,
        ),
    )


def request(owner, action, *, client="a", sequence=0, identity=None):
    lease = owner.authority.lease_id if owner.authority is not None else "retired"
    return owner.handle(
        client,
        InteractionRequest(
            identity or f"{action}-{sequence}",
            action,
            owner.epoch,
            lease_id=lease,
            sequence=sequence,
            position=(1.0, 2.0, 0.0),
            orientation=(0.0, 0.0, 0.0, 1.0),
        ),
    )


@pytest.mark.parametrize("first,second", [("a", "b"), ("b", "a")])
def test_first_acquisition_is_robot_wide(fixture, first, second):
    owner, _ = fixture
    assert acquire(owner, first).status == "accepted"
    assert acquire(owner, second, kind="joystick").status == "busy"
    assert owner.authority.client_id == first
    assert not owner.authorized(second, owner.epoch, owner.authority.lease_id)


def test_selected_planning_retains_authority_between_gestures(fixture):
    owner, now = fixture
    acquire(owner, kind="navigation_planning")
    request(owner, "update")
    request(owner, "release", sequence=1)
    assert owner.authority is not None and not owner.authority.held
    assert owner.target.phase == "draft"
    assert acquire(owner, "b").status == "busy"
    now[0] += 0.4
    request(owner, "renew", identity="renew")
    now[0] += 0.4
    assert not owner.poll()
    request(owner, "confirm", sequence=2)
    assert owner.authority is None and owner.target.phase == "committed"
    assert acquire(owner, "b", identity="second-grab").status == "accepted"


def test_atomic_final_pose_and_duplicate_release(fixture):
    owner, _ = fixture
    acquire(owner)
    commits = []
    packet = InteractionRequest(
        "release",
        "release",
        owner.epoch,
        lease_id=owner.authority.lease_id,
        sequence=3,
        position=(3.25, -1.5, 0.0),
        orientation=(0.0, 0.0, 1.0, 1.0),
    )
    for _ in range(2):
        result = owner.handle(
            "a", packet, commit=lambda target, kind: commits.append(target) or True
        )
        assert result.status == "accepted"
    assert len(commits) == 1 and owner.authority is None
    assert owner.target.position == (3.25, -1.5, 0.0) and owner.target.phase == "committed"
    assert acquire(owner).code == "lease_retired"


def test_disconnect_isolated_and_shared_target_retained(fixture):
    owner, _ = fixture
    acquire(owner)
    request(owner, "update")
    owner.disconnect("b")
    assert owner.authority.client_id == "a"
    owner.disconnect("a")
    assert owner.authority is None and owner.target.position == (1.0, 2.0, 0.0)
    assert owner.drain_retirements()[0][1] == "disconnect"
    assert request(owner, "update").code == "connection_retired"


def test_expiry_and_late_messages_cannot_affect_replacement(fixture):
    owner, now = fixture
    acquire(owner)
    old = owner.authority.lease_id
    now[0] += 0.5
    assert owner.poll()
    assert owner.drain_retirements()[0][1] == "expired"
    acquire(owner, "b")
    for action in ("renew", "release", "confirm", "cancel"):
        reply = owner.handle(
            "a",
            InteractionRequest(
                action,
                action,
                owner.epoch,
                lease_id=old,
                sequence=7,
                position=(99.0, 0.0, 0.0),
                orientation=(0.0, 0.0, 0.0, 1.0),
            ),
        )
        assert reply.status == "busy"
    assert owner.authority.client_id == "b"


def test_cancel_before_acquisition_prevents_late_grant(fixture):
    owner, _ = fixture
    owner.handle(
        "a", InteractionRequest("cancel", "cancel_acquire", owner.epoch, acquisition_id="lost")
    )
    assert acquire(owner, identity="lost").code == "acquisition_cancelled"
    assert owner.authority is None


def test_stale_sequence_and_epoch_preserve_state(fixture):
    owner, _ = fixture
    acquire(owner)
    request(owner, "update", sequence=3)
    before = owner.snapshot()
    assert request(owner, "update", sequence=2).code == "sequence_retired"
    assert owner.snapshot() == before
    packet = InteractionRequest(
        "old",
        "update",
        "retired",
        lease_id=owner.authority.lease_id,
        sequence=4,
        position=(9.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    assert owner.handle("a", packet).code == "epoch_changed"
    assert owner.snapshot() == before


def test_equal_samples_preserve_preview_and_late_preview_is_rejected(fixture):
    owner, _ = fixture
    acquire(owner, kind="navigation_planning")
    request(owner, "update")
    lease, revision = owner.authority.lease_id, owner.target.revision
    request(owner, "update", sequence=1)
    assert owner.target.revision == revision
    assert owner.set_preview(
        {"path_poses": [[1, 2, 0, 0]]}, epoch=owner.epoch, lease_id=lease, target_revision=revision
    )
    request(owner, "cancel", sequence=2)
    acquire(owner, "b", kind="navigation_planning")
    assert not owner.set_preview({}, epoch=owner.epoch, lease_id=lease, target_revision=revision)


def test_draft_does_not_replace_execution_and_snapshots_are_detached(fixture):
    owner, _ = fixture
    owner.set_active_goal({"pose": [5, 5, 0, 0]})
    acquire(owner, kind="navigation_planning")
    request(owner, "update")
    request(owner, "release", sequence=1)
    snapshot = owner.snapshot()
    snapshot["target"]["position"][0] = 999
    snapshot["active_goal"]["pose"][0] = 999
    assert owner.snapshot()["active_goal"]["pose"] == [5, 5, 0, 0]
    assert owner.target.position == (1.0, 2.0, 0.0)


def test_mode_shared_and_active_agent_turn_blocks_transition(fixture):
    owner, _ = fixture
    packet = InteractionRequest("mode", "mode", owner.epoch, mode="agent")
    assert owner.handle("b", packet).status == "accepted"
    assert owner.snapshot()["mode"] == "agent" and acquire(owner).status == "busy"
    owner.agent_busy = True
    assert owner.handle("c", replace(packet, request_id="manual", mode="manual")).status == "busy"
    owner.agent_busy = False
    assert (
        owner.handle("c", replace(packet, request_id="manual2", mode="manual")).status == "accepted"
    )


def test_source_reset_clears_authority_and_rotates_epoch(fixture):
    owner, _ = fixture
    acquire(owner)
    request(owner, "update")
    epoch = owner.epoch
    owner.reset()
    assert owner.epoch != epoch and owner.target is None and owner.authority is None
    assert not owner.snapshot()["targets"]


@pytest.mark.parametrize(
    "invalid",
    [
        {"action": "typo"},
        {"sequence": True},
        {"sequence": -1},
        {"position": [0, 0, float("nan")], "orientation": [0, 0, 0, 1]},
        {"position": [0, 0, 0]},
        {"position": [0, 0, 0], "orientation": [0, 0, 0, 0]},
        {"kind": "unknown"},
        {"mode": "unknown"},
        {"request_id": ""},
        {"speed_scale": 0},
        {"gripper": 2},
    ],
)
def test_invalid_wire_command_rejected(invalid):
    with pytest.raises((ValueError, TypeError)):
        decode_interaction_request({"request_id": "r", "action": "update", **invalid})


def test_request_history_bounded(fixture):
    owner, _ = fixture
    for index in range(300):
        owner.handle("a", InteractionRequest(f"s{index}", "snapshot"))
    assert len(owner._requests["a"]) == 128
    owner.disconnect("a")
    assert "a" not in owner._requests


def test_arm_and_navigation_targets_are_distinct(fixture):
    owner, _ = fixture
    acquire(owner)
    request(owner, "release")
    acquire(owner, "b", "manipulation_planning", "arm", group_id="left")
    request(owner, "update", client="b")
    request(owner, "release", client="b", sequence=1)
    assert owner.authority is None
    assert {target["domain"] for target in owner.snapshot()["targets"]} == {
        "navigation",
        "manipulation",
    }
    assert owner.target.group_id == "left" and owner.target.phase == "draft"


def test_submillimetre_jitter_retains_preview_and_accepts_inflight_result(fixture):
    owner, _ = fixture
    acquire(owner, kind="navigation_planning")
    request(owner, "update")
    lease, revision = owner.authority.lease_id, owner.target.revision
    frame = {"pose": [1, 2, 0, 0], "path_poses": [[1, 2, 0, 0]]}
    assert owner.set_preview(frame, epoch=owner.epoch, lease_id=lease, target_revision=revision)
    for sequence in range(1, 20):
        owner.handle(
            "a",
            InteractionRequest(
                f"jitter-{sequence}",
                "update",
                owner.epoch,
                lease_id=lease,
                sequence=sequence,
                position=(1 + sequence * 0.00001, 2, 0),
                orientation=(0, 0, 0, 1),
            ),
        )
        assert owner.preview == frame
    assert owner.target.revision > revision
    assert owner.set_preview(frame, epoch=owner.epoch, lease_id=lease, target_revision=revision)


def test_accumulated_aim_change_invalidates_route_and_rejects_old_result(fixture):
    owner, _ = fixture
    acquire(owner, kind="navigation_planning")
    request(owner, "update")
    lease, revision = owner.authority.lease_id, owner.target.revision
    frame = {"pose": [1, 2, 0, 0], "path_poses": [[1, 2, 0, 0]]}
    assert owner.set_preview(frame, epoch=owner.epoch, lease_id=lease, target_revision=revision)
    for sequence in range(1, 5):
        owner.handle(
            "a",
            InteractionRequest(
                f"drift-{sequence}",
                "update",
                owner.epoch,
                lease_id=lease,
                sequence=sequence,
                position=(1 + sequence * 0.051, 2, 0),
                orientation=(0, 0, 0, 1),
            ),
        )
    assert owner.preview is None
    assert not owner.set_preview(frame, epoch=owner.epoch, lease_id=lease, target_revision=revision)


def test_advisory_yaw_tolerance_is_bounded_and_wraps(fixture):
    import math

    owner, _ = fixture
    acquire(owner, kind="navigation_planning")
    request(owner, "update")
    lease, revision = owner.authority.lease_id, owner.target.revision
    frame = {"pose": [1, 2, 0, math.radians(179)], "path_poses": []}
    owner.handle(
        "a",
        InteractionRequest(
            "wrap",
            "update",
            owner.epoch,
            lease_id=lease,
            sequence=1,
            position=(1, 2, 0),
            orientation=(0, 0, math.sin(math.radians(-179) / 2), math.cos(math.radians(-179) / 2)),
        ),
    )
    assert owner.set_preview(frame, epoch=owner.epoch, lease_id=lease, target_revision=revision)
    owner.handle(
        "a",
        InteractionRequest(
            "turn",
            "update",
            owner.epoch,
            lease_id=lease,
            sequence=2,
            position=(1, 2, 0),
            orientation=(0, 0, math.sin(math.radians(160) / 2), math.cos(math.radians(160) / 2)),
        ),
    )
    assert owner.preview is None
    assert not owner.set_preview(frame, epoch=owner.epoch, lease_id=lease, target_revision=revision)


def test_preview_tolerance_uses_requested_aim_not_adjusted_safe_endpoint(fixture):
    owner, _ = fixture
    acquire(owner, kind="navigation_planning")
    request(owner, "update")
    lease, revision = owner.authority.lease_id, owner.target.revision
    frame = {"pose": [3, 2, 0, 0], "path_poses": [[3, 2, 0, 0]]}
    source = {"source_position": (1, 2, 0), "source_orientation": (0, 0, 0, 1)}
    assert owner.set_preview(
        frame, epoch=owner.epoch, lease_id=lease, target_revision=revision, **source
    )
    owner.handle(
        "a",
        InteractionRequest(
            "jitter-safe-endpoint",
            "update",
            owner.epoch,
            lease_id=lease,
            sequence=1,
            position=(1.0001, 2, 0),
            orientation=(0, 0, 0, 1),
        ),
    )
    assert owner.preview == frame
    assert owner.set_preview(
        frame, epoch=owner.epoch, lease_id=lease, target_revision=revision, **source
    )
