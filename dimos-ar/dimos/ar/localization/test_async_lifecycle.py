from __future__ import annotations

import asyncio
from dataclasses import replace
import math
import threading
from types import SimpleNamespace

import numpy as np
import pytest

from dimos.ar.localization.coordinator import LocalizationOutcome
from dimos.ar.localization.odom_map_transform import OdomMapTransform
from dimos.ar.localization.policy import LocalizationPolicy
from dimos.ar.localization.pose_buffer import PoseBuffer
from dimos.ar.localization.runner import LocalizationRunner
from dimos.ar.localization.test_coordinator import _coordinator, _observation
from dimos.ar.localization.test_policy import _advance
from dimos.ar.localization.types import LocalizedPose
from dimos.ar.localization.vps.robot_observation_buffer import (
    RobotObservationBuffer,
    RobotObservationSample,
)
from dimos.ar.localization.vps.test_robot_observation_buffer import _camera_info, _image
from dimos.ar.localization.worker import LocalizationWorker
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


def _pose(ts: float, *, x: float = 0, yaw: float = 0) -> PoseStamped:
    return PoseStamped(
        ts=ts,
        frame_id="world",
        position=[x, 0, 0.33],
        orientation=[0, 0, math.sin(yaw / 2), math.cos(yaw / 2)],
    )


def test_pose_history_rejects_long_gaps_even_near_one_endpoint() -> None:
    history = PoseBuffer()
    history.push(_pose(10), ts_server=10)
    history.push(_pose(15, x=5), ts_server=15)
    assert history.at_server_ts(10.01) is None


@pytest.mark.parametrize("timestamp", [float("nan"), float("inf"), 9.0])
def test_pose_history_rejects_invalid_or_out_of_order_time(timestamp: float) -> None:
    history = PoseBuffer()
    history.push(_pose(10), ts_server=10)
    with pytest.raises(ValueError):
        history.push(_pose(timestamp), ts_server=timestamp)
    assert history.latest().ts_server == 10


def test_pose_snapshot_is_independent_and_interpolates_capture_travel() -> None:
    history = PoseBuffer()
    history.push(_pose(10), ts_server=10)
    history.push(_pose(10.1, x=0.2), ts_server=10.1)
    frozen = history.snapshot()
    history.clear()
    assert history.latest() is None
    assert frozen.at_server_ts(10.05).travel_m == pytest.approx(0.1)


@pytest.mark.parametrize("rotating", [False, True])
def test_robot_capture_pairs_moving_pose_without_extrapolation(rotating: bool) -> None:
    history = PoseBuffer()
    buffer = RobotObservationBuffer(pose_buffer=history, T_base_camera_optical=np.eye(4))
    buffer.set_camera_info(_camera_info())
    history.push(_pose(9.95, x=0, yaw=0), ts_server=9.95)
    assert buffer.prepare_image(_image(10), ts_server=10, travel_m=0) is None
    history.push(_pose(10.05, x=0.2, yaw=0.2 if rotating else 0), ts_server=10.05)
    sample = buffer.prepare_image(_image(10), ts_server=10, travel_m=0.1)
    assert sample is not None
    assert sample.observation.camera_pose.x == pytest.approx(0.1)
    assert sample.observation.camera_pose.orientation.z == pytest.approx(
        math.sin(0.05) if rotating else 0
    )
    buffer.add_sample(sample)
    assert buffer.newest(now_server=11) is sample
    assert buffer.newest(now_server=12.01) is None
    buffer.clear()
    assert buffer.newest(now_server=11) is None


def test_robot_capture_rejects_pose_brackets_over_200ms() -> None:
    history = PoseBuffer()
    buffer = RobotObservationBuffer(pose_buffer=history, T_base_camera_optical=np.eye(4))
    buffer.set_camera_info(_camera_info())
    history.push(_pose(9.9), ts_server=9.9)
    history.push(_pose(10.11, x=1), ts_server=10.11)
    assert buffer.prepare_image(_image(10), ts_server=10, travel_m=0) is None


async def test_cancelled_cpu_work_keeps_actual_worker_admission_bounded() -> None:
    worker = LocalizationWorker()
    started = threading.Event()
    release = threading.Event()
    calls = []

    def blocking():
        calls.append("first")
        started.set()
        release.wait(3)
        return "discarded"

    task = asyncio.create_task(worker.run(blocking))
    try:
        assert await asyncio.to_thread(started.wait, 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        next_task = asyncio.create_task(worker.run(lambda: calls.append("second")))
        await asyncio.sleep(0.02)
        assert calls == ["first"]
        release.set()
        await asyncio.wait_for(next_task, 1)
        assert calls == ["first", "second"]
    finally:
        release.set()
        worker.close()


@pytest.mark.parametrize("failure", ["timeout", "exception", "disconnect", "replacement"])
async def test_runner_bounds_episode_and_discards_retired_results(failure: str) -> None:
    policy = LocalizationPolicy(["vps"])
    policy.on_hello("client")
    work = policy.on_observations("client", [_observation()])
    release = asyncio.Event()
    started = asyncio.Event()
    outcomes = []

    async def run(_observations, **_kwargs):
        started.set()
        await release.wait()
        if failure == "exception":
            raise ValueError("provider failed")
        return LocalizationOutcome(used_vps=True)

    async def close():
        pass

    runner = LocalizationRunner(
        coordinator=SimpleNamespace(run=run, close=close),
        policy=policy,
        on_outcome=lambda *args: outcomes.append(args),
        on_prompt=lambda _client: None,
        timeout_s=0.05,
    )
    try:
        runner.submit(work)
        await started.wait()
        runner.submit(work)
        assert len(runner._tasks) == 1
        assert policy.on_observations("client", [_observation()]) is None
        if failure == "disconnect":
            runner.cancel("client")
            policy.on_disconnect("client")
        elif failure == "replacement":
            runner.cancel("client")
            policy.on_start_request("client")
        elif failure == "timeout":
            await asyncio.sleep(0.07)
        release.set()
        await asyncio.gather(*tuple(runner._jobs), return_exceptions=True)
        assert len(outcomes) == (1 if failure in ("timeout", "exception") else 0)
    finally:
        await runner.close()


async def test_cooldown_poll_requests_fresh_pixels_without_odometry() -> None:
    now = [0.0]
    policy = LocalizationPolicy(["vps"], clock=lambda: now[0])
    policy.begin_client_vps()
    assert policy.on_hello("client") is None
    prompts = []

    async def close():
        pass

    runner = LocalizationRunner(
        coordinator=SimpleNamespace(close=close),
        policy=policy,
        on_outcome=lambda *_args: None,
        on_prompt=prompts.append,
    )
    try:
        runner.start()
        now[0] = 30
        await asyncio.sleep(0.3)
        assert prompts == ["client"]
    finally:
        await runner.close()


@pytest.mark.parametrize("change", ["travel", "age", "generation"])
async def test_robot_anchor_expiring_during_query_cannot_produce_alignment(change: str) -> None:
    now = [3.0]
    generation = [0]
    calls = []
    coordinator = None

    async def localize(observations):
        calls.append(observations)
        if change == "travel":
            _advance(coordinator._policy, 0, 0)
            _advance(coordinator._policy, 3, 0)
        elif change == "age":
            now[0] = 65
        else:
            generation[0] += 1
        return LocalizedPose(Pose(0, 0, 0), "map", 0.9)

    coordinator = _coordinator(
        providers=["vps"],
        vps=SimpleNamespace(localize=localize),
        robot_sample=RobotObservationSample(_observation(2), 0),
    )
    coordinator._clock = lambda: now[0]
    coordinator._source_generation = lambda: generation[0]
    try:
        outcome = await coordinator.run([_observation(3)])
        assert outcome.result is None
        assert coordinator._odom_map_transform.vps_sample() is None
        assert len(calls) == 1  # Do not spend a headset query on an expired robot fix.
    finally:
        coordinator._worker.close()


async def test_anchor_snapshot_and_confidence_include_robot_quality() -> None:
    coordinator = _coordinator(providers=["vps"])
    transforms = coordinator._odom_map_transform
    robot = LocalizedPose(Pose(10, 0, 0), "map", 0.51)
    transforms.update_from_vps(robot, ts_server=2, travel_m=0, map_code="office")

    async def localize(_observations, **_kwargs):
        # A replacement must not alter the already captured composition snapshot.
        transforms.update_from_vps(
            replace(robot, pose=Pose(20, 0, 0)), ts_server=3, travel_m=0, map_code="office"
        )
        return LocalizedPose(Pose(11, 0, 0), "map", 0.99)

    coordinator._vps = SimpleNamespace(localize=localize)
    try:
        outcome = await coordinator.run([_observation(3)])
        assert outcome.result.position[0] == pytest.approx(1)
        assert outcome.result.confidence == 0.51
    finally:
        coordinator._worker.close()


def test_anchor_age_map_generation_and_finite_confidence_are_required() -> None:
    transforms = OdomMapTransform()
    localization = LocalizedPose(Pose(0, 0, 0), "map", 0.9)
    assert not transforms.update_from_vps(
        replace(localization, confidence=float("nan")), ts_server=10, travel_m=0
    )
    assert transforms.update_from_vps(
        localization, ts_server=10, travel_m=0, map_code="office", source_generation=1
    )
    sample = transforms.vps_sample()
    with pytest.raises(ValueError):
        sample.T_odom_map[0, 3] = 999
    args = {"now_server": 11, "current_travel_m": 0, "map_code": "office", "source_generation": 1}
    assert transforms.is_vps_reusable(**args)
    assert not transforms.is_vps_reusable(**{**args, "now_server": 71})
    assert not transforms.is_vps_reusable(**{**args, "map_code": "elsewhere"})
    assert not transforms.is_vps_reusable(**{**args, "source_generation": 2})
    transforms.clear()
    assert not transforms.is_vps_reusable(**args)


def test_success_uses_capture_travel_not_http_completion_travel() -> None:
    policy = LocalizationPolicy(["fiducial_marker"])
    policy.on_hello("client")
    _advance(policy, 0, 0)
    _advance(policy, 0.8, 0)
    policy.on_success("client", capture_travel_m=0)
    assert _advance(policy, 0.8, 0) == (["client"], [])


def test_exact_pose_remains_usable_beside_a_history_gap() -> None:
    history = PoseBuffer()
    history.push(_pose(10))
    history.push(_pose(15, x=5))
    assert history.at_server_ts(10).position[0] == 0
    assert history.at_server_ts(10.01) is None


async def test_vendor_response_to_robot_and_headset_alignment_randomized() -> None:
    import cv2
    from scipy.spatial.transform import Rotation

    from dimos.ar.localization.coordinator import LocalizationCoordinator
    from dimos.ar.localization.types import Intrinsics, Observation
    from dimos.ar.localization.vps.localizer import VpsLocalizer
    from dimos.ar.localization.vps.multiset_client import _result_from_payload
    from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE
    from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

    rng = np.random.default_rng(617)
    responses = []

    class Vendor:
        async def query(self, **_kwargs):
            return _result_from_payload(responses.pop(0))

        async def close(self):
            pass

    # Independent axis matrices used to construct vendor JSON fixtures.
    vendor_to_zup = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]])
    optical_to_vendor = np.diag([1, -1, -1, 1])

    def transform(*, tilted=False):
        matrix = np.eye(4)
        matrix[:3, :3] = (
            Rotation.random(random_state=rng).as_matrix()
            if tilted
            else Rotation.from_euler("z", rng.uniform(-math.pi, math.pi)).as_matrix()
        )
        matrix[:3, 3] = rng.uniform(-10, 10, 3)
        return matrix

    def response(optical_in_map):
        vendor = np.linalg.inv(vendor_to_zup) @ optical_in_map @ optical_to_vendor
        xyz = vendor[:3, 3]
        quat = Rotation.from_matrix(vendor[:3, :3]).as_quat()
        return {
            "poseFound": True,
            "position": dict(zip("xyz", xyz, strict=True)),
            "rotation": dict(zip(("x", "y", "z", "w"), quat, strict=True)),
            "confidence": 0.9,
        }

    ok, encoded = cv2.imencode(".jpg", np.zeros((16, 16, 3), dtype=np.uint8))
    assert ok
    intrinsics = Intrinsics(10, 10, 8, 8, 16, 16, "none", ())
    worker = LocalizationWorker()
    policy = LocalizationPolicy(["vps"], client_vps_cooldown_s=0, robot_vps_cooldown_s=0)
    robot_frames = RobotObservationBuffer(pose_buffer=PoseBuffer(), T_base_camera_optical=np.eye(4))
    coordinator = LocalizationCoordinator(
        policy=policy,
        odom_map_transform=OdomMapTransform(),
        robot_observations=robot_frames,
        marker=None,
        vps=VpsLocalizer(client=Vendor(), worker=worker),
        worker=worker,
        clock=lambda: 100.0,
        map_code="office",
    )
    try:
        for _ in range(300):
            expected_origin = transform()
            odom_in_map = transform()
            body_in_odom = transform(tilted=True)
            optical_in_client = transform(tilted=True)
            optical_in_odom = body_in_odom @ UNITREE_GO2_PROFILE.T_base_camera_optical
            responses.extend(
                [
                    response(odom_in_map @ optical_in_odom),
                    response(odom_in_map @ expected_origin @ optical_in_client),
                ]
            )
            coordinator.invalidate_source()
            robot_frames.add_sample(
                RobotObservationSample(
                    Observation(
                        encoded.tobytes(), intrinsics, matrix_to_pose(optical_in_odom), 100
                    ),
                    0,
                )
            )
            outcome = await coordinator.run(
                [Observation(encoded.tobytes(), intrinsics, matrix_to_pose(optical_in_client), 100)]
            )
            assert outcome.result is not None
            actual = pose_to_matrix(Pose(*outcome.result.position, *outcome.result.orientation))
            assert np.allclose(actual, expected_origin, atol=1e-9)
    finally:
        await coordinator.close()


@pytest.mark.parametrize("change", ["travel", "age", "generation"])
async def test_anchor_expiring_during_headset_query_discards_final_result(change: str) -> None:
    now = [3.0]
    generation = [0]
    calls = []
    coordinator = None

    async def localize(observations):
        calls.append(observations)
        if len(calls) == 2:
            if change == "travel":
                _advance(coordinator._policy, 0, 0)
                _advance(coordinator._policy, 3, 0)
            elif change == "age":
                now[0] = 65
            else:
                generation[0] += 1
        return LocalizedPose(Pose(0, 0, 0), "map", 0.9)

    coordinator = _coordinator(
        providers=["vps"],
        vps=SimpleNamespace(localize=localize),
        robot_sample=RobotObservationSample(_observation(2), 0),
    )
    coordinator._clock = lambda: now[0]
    coordinator._source_generation = lambda: generation[0]
    try:
        assert (await coordinator.run([_observation(3)])).result is None
        assert len(calls) == 2
    finally:
        coordinator._worker.close()
