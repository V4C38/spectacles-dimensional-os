from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import math

import cv2
import numpy as np
import pytest

from dimos.ar.localization.types import Intrinsics, Observation
from dimos.ar.localization.vps.localizer import VpsLocalizer, VpsLocalizerConfig
import dimos.ar.localization.vps.multiset_client as multiset_module
from dimos.ar.localization.vps.multiset_client import (
    MultisetVpsAuthError,
    MultisetVpsClient,
    MultisetVpsClientConfig,
    MultisetVpsError,
    map_camopt_from_vendor_pose,
    parse_expires_on,
)
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.utils.transform_utils import pose_to_matrix

_SQRT_HALF = math.sqrt(0.5)


@dataclass
class _FakeResponse:
    status_code: int
    payload: object = None
    text: str = ""

    def json(self) -> object:
        if self.payload is None:
            raise ValueError("no json")
        return self.payload


@dataclass
class _RecordedPost:
    url: str
    headers: dict[str, str] | None
    data: dict[str, str] | None
    files: dict[str, tuple[str, bytes, str]] | None
    timeout: float


class _FakeClock:
    def __init__(self, now: float) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class _FakeSession:
    def __init__(self, responses: list[_FakeResponse]) -> None:
        self._responses = list(responses)
        self.calls: list[_RecordedPost] = []

    def post(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        data: dict[str, str] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
        timeout: float,
    ) -> _FakeResponse:
        self.calls.append(
            _RecordedPost(
                url=url,
                headers=headers,
                data=data,
                files=files,
                timeout=timeout,
            )
        )
        if not self._responses:
            raise AssertionError(f"unexpected HTTP POST to {url}")
        return self._responses.pop(0)


def _intrinsics(*, width: int = 960, height: int = 720) -> Intrinsics:
    return Intrinsics(
        fx=669.53,
        fy=669.53,
        cx=width / 2.0,
        cy=height / 2.0,
        width=width,
        height=height,
        distortion_model="none",
        distortion=(),
    )


def _jpeg(*, width: int = 960, height: int = 720) -> bytes:
    ok, encoded = cv2.imencode(
        ".jpg",
        np.zeros((height, width, 3), dtype=np.uint8),
    )
    assert ok
    return encoded.tobytes()


def _observation(
    *,
    image_width: int = 960,
    image_height: int = 720,
    intrinsics: Intrinsics | None = None,
) -> Observation:
    return Observation(
        jpeg=_jpeg(width=image_width, height=image_height),
        intrinsics=intrinsics or _intrinsics(width=image_width, height=image_height),
        camera_pose=Pose(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
        ts_server=100.0,
    )


def _config(**overrides: object) -> MultisetVpsClientConfig:
    values: dict[str, object] = {"map_code": "MAP_TEST"}
    values.update(overrides)
    return MultisetVpsClientConfig(**values)  # type: ignore[arg-type]


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _token_response(*, token: str = "jwt-1", expires_at: float = 1_800.0) -> _FakeResponse:
    return _FakeResponse(
        status_code=200,
        payload={"token": token, "expiresOn": _iso(expires_at)},
    )


def _found_response(
    *,
    position: tuple[float, float, float] = (4.0, 2.0, 0.0),
    rotation: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0),
    confidence: float = 0.87,
) -> _FakeResponse:
    return _FakeResponse(
        status_code=200,
        payload={
            "poseFound": True,
            "position": {"x": position[0], "y": position[1], "z": position[2]},
            "rotation": {
                "x": rotation[0],
                "y": rotation[1],
                "z": rotation[2],
                "w": rotation[3],
            },
            "confidence": confidence,
        },
    )


def _wire_client(
    client: MultisetVpsClient,
    session: _FakeSession,
    monkeypatch: pytest.MonkeyPatch,
    *,
    clock: _FakeClock | None = None,
) -> MultisetVpsClient:
    client._session = session  # type: ignore[attr-defined]
    monkeypatch.setattr(multiset_module, "_utc_now", clock or _FakeClock(0.0))
    return client


def _client(
    session: _FakeSession,
    monkeypatch: pytest.MonkeyPatch,
    *,
    clock: _FakeClock | None = None,
    config: MultisetVpsClientConfig | None = None,
    from_env: bool = False,
) -> MultisetVpsClient:
    if from_env:
        monkeypatch.setenv("MULTISET_CLIENT_ID", "env-id")
        monkeypatch.setenv("MULTISET_CLIENT_SECRET", "env-secret")
        client = MultisetVpsClient.from_env(config or _config())
    else:
        client = MultisetVpsClient(
            config=config or _config(),
            client_id="id",
            client_secret="secret",
        )
    return _wire_client(client, session, monkeypatch, clock=clock)


def _assert_matrix(pose: Pose, expected: list[list[float]]) -> None:
    assert pose_to_matrix(pose) == pytest.approx(np.array(expected, dtype=np.float64))


def test_map_camopt_from_identity_vendor_pose_swaps_up_and_optical_axes() -> None:
    converted = map_camopt_from_vendor_pose(Pose(1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 1.0))

    _assert_matrix(
        converted,
        [
            [1.0, 0.0, 0.0, 1.0],
            [0.0, 0.0, 1.0, -3.0],
            [0.0, -1.0, 0.0, 2.0],
            [0.0, 0.0, 0.0, 1.0],
        ],
    )


def test_map_camopt_from_vendor_yaw_is_not_up_axis_only() -> None:
    converted = map_camopt_from_vendor_pose(Pose(0.0, 0.0, 0.0, 0.0, _SQRT_HALF, 0.0, _SQRT_HALF))

    _assert_matrix(
        converted,
        [
            [0.0, 0.0, -1.0, 0.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, -1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ],
    )


def test_parse_expires_on_accepts_z_and_naive() -> None:
    zulu = parse_expires_on("2026-08-27T21:00:00.000Z")
    offset = parse_expires_on("2026-08-27T21:00:00+00:00")
    naive = parse_expires_on("2026-08-27T21:00:00")

    assert zulu == pytest.approx(offset)
    assert naive == pytest.approx(offset)


def test_query_with_pose_found_false_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession(
        [
            _token_response(),
            _FakeResponse(status_code=200, payload={"poseFound": False}),
        ]
    )

    assert _client(session, monkeypatch).query(jpeg=_jpeg(), intrinsics=_intrinsics()) is None


def test_query_sends_form_fields_and_converts_found_pose(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession([_token_response(), _found_response()])
    client = _client(session, monkeypatch)
    vendor = Pose(4.0, 2.0, 0.0, 0.0, 0.0, 0.0, 1.0)

    result = client.query(jpeg=_jpeg(), intrinsics=_intrinsics())

    assert result is not None
    assert result.confidence == pytest.approx(0.87)
    _assert_matrix(result.camera_pose, pose_to_matrix(map_camopt_from_vendor_pose(vendor)).tolist())

    assert len(session.calls) == 2
    auth, query = session.calls
    assert auth.url.endswith("/m2m/token")
    assert auth.headers is not None
    assert auth.headers["Authorization"].startswith("Basic ")
    assert auth.data is None
    assert query.url.endswith("/vps/map/query-form")
    assert query.headers == {"Authorization": "Bearer jwt-1"}
    assert query.data == {
        "mapCode": "MAP_TEST",
        "fx": "669.53",
        "fy": "669.53",
        "px": "480",
        "py": "360",
        "width": "960",
        "height": "720",
        "isRightHanded": "true",
        "queryMode": "vps-1",
    }
    assert "hintPosition" not in query.data
    assert query.files is not None
    assert query.files["queryImage"][0] == "query.jpg"
    assert query.files["queryImage"][2] == "image/jpeg"
    assert query.timeout == pytest.approx(90.0)


def test_vps_localizer_accepts_multiset_client_result(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession([_token_response(), _found_response()])
    client = _client(session, monkeypatch)
    localizer = VpsLocalizer(
        client=client,
        config=VpsLocalizerConfig(max_tilt_rad=math.pi),
    )

    result = localizer.localize([_observation()])

    assert result is not None
    assert result.frame_id == "map"
    assert result.confidence == pytest.approx(0.87)
    assert len(session.calls) == 2


def test_token_is_cached_until_refresh_margin(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = _FakeClock(1_000.0)
    session = _FakeSession(
        [
            _token_response(expires_at=2_800.0),
            _found_response(),
            _found_response(),
        ]
    )
    client = _client(session, monkeypatch, clock=clock)

    assert client.query(jpeg=_jpeg(), intrinsics=_intrinsics()) is not None
    clock.now = 2_700.0
    assert client.query(jpeg=_jpeg(), intrinsics=_intrinsics()) is not None

    assert [call.url.rsplit("/", 2)[-1] for call in session.calls] == [
        "token",
        "query-form",
        "query-form",
    ]


def test_token_refreshes_before_expires_on(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = _FakeClock(1_000.0)
    session = _FakeSession(
        [
            _token_response(token="jwt-1", expires_at=1_100.0),
            _found_response(),
            _token_response(token="jwt-2", expires_at=2_800.0),
            _found_response(),
        ]
    )
    client = _client(session, monkeypatch, clock=clock)

    assert client.query(jpeg=_jpeg(), intrinsics=_intrinsics()) is not None
    clock.now = 1_040.0
    assert client.query(jpeg=_jpeg(), intrinsics=_intrinsics()) is not None

    query_auths = [
        call.headers["Authorization"] for call in session.calls if call.url.endswith("/query-form")
    ]
    assert query_auths == ["Bearer jwt-1", "Bearer jwt-2"]


def test_query_retries_once_after_401(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession(
        [
            _token_response(token="jwt-1"),
            _FakeResponse(status_code=401, text="expired"),
            _token_response(token="jwt-2"),
            _found_response(),
        ]
    )

    result = _client(session, monkeypatch).query(jpeg=_jpeg(), intrinsics=_intrinsics())

    assert result is not None
    assert [call.url.rsplit("/", 1)[-1] for call in session.calls] == [
        "token",
        "query-form",
        "token",
        "query-form",
    ]
    assert session.calls[1].headers == {"Authorization": "Bearer jwt-1"}
    assert session.calls[3].headers == {"Authorization": "Bearer jwt-2"}


def test_second_401_raises_auth_error(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession(
        [
            _token_response(token="jwt-1"),
            _FakeResponse(status_code=401, text="expired"),
            _token_response(token="jwt-2"),
            _FakeResponse(status_code=401, text="still expired"),
        ]
    )

    with pytest.raises(MultisetVpsAuthError, match="401 after token refresh"):
        _client(session, monkeypatch).query(jpeg=_jpeg(), intrinsics=_intrinsics())


def test_http_error_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession(
        [
            _token_response(),
            _FakeResponse(status_code=400, text='{"error":"bad image"}'),
        ]
    )

    with pytest.raises(MultisetVpsError, match="HTTP 400"):
        _client(session, monkeypatch).query(jpeg=_jpeg(), intrinsics=_intrinsics())


def test_auth_error_body_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession([_FakeResponse(status_code=200, payload={"error": "invalid client"})])

    with pytest.raises(MultisetVpsAuthError, match="invalid client"):
        _client(session, monkeypatch).query(jpeg=_jpeg(), intrinsics=_intrinsics())


def test_missing_expires_on_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession([_FakeResponse(status_code=200, payload={"token": "jwt-1"})])

    with pytest.raises(MultisetVpsAuthError, match="expiresOn"):
        _client(session, monkeypatch).query(jpeg=_jpeg(), intrinsics=_intrinsics())


def test_malformed_found_pose_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession(
        [
            _token_response(),
            _FakeResponse(status_code=200, payload={"poseFound": True, "confidence": 0.9}),
        ]
    )

    with pytest.raises(MultisetVpsError, match="position"):
        _client(session, monkeypatch).query(jpeg=_jpeg(), intrinsics=_intrinsics())


def test_confidence_outside_unit_interval_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession([_token_response(), _found_response(confidence=1.1)])

    with pytest.raises(MultisetVpsError, match="confidence"):
        _client(session, monkeypatch).query(jpeg=_jpeg(), intrinsics=_intrinsics())


def test_from_env_reads_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _FakeSession([_token_response(), _found_response()])

    assert (
        _client(session, monkeypatch, from_env=True).query(jpeg=_jpeg(), intrinsics=_intrinsics())
        is not None
    )
    basic = session.calls[0].headers["Authorization"]
    assert basic.startswith("Basic ")


def test_from_env_requires_both_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MULTISET_CLIENT_ID", "env-id")
    monkeypatch.delenv("MULTISET_CLIENT_SECRET", raising=False)
    with pytest.raises(ValueError, match="MULTISET_CLIENT_SECRET"):
        MultisetVpsClient.from_env(_config())


def test_empty_jpeg_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="jpeg"):
        _client(_FakeSession([]), monkeypatch).query(jpeg=b"", intrinsics=_intrinsics())


def test_distorted_intrinsics_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    distorted = Intrinsics(
        fx=800.0,
        fy=800.0,
        cx=640.0,
        cy=360.0,
        width=1280,
        height=720,
        distortion_model="equidistant",
        distortion=(-0.07, -0.02, -0.01, 0.01),
    )
    with pytest.raises(ValueError, match="pinhole"):
        _client(_FakeSession([]), monkeypatch).query(jpeg=_jpeg(), intrinsics=distorted)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("map_code", "  "),
        ("api_base", ""),
        ("auth_path", "m2m/token"),
        ("query_path", "vps/map/query-form"),
        ("timeout_s", 0.0),
        ("token_refresh_margin_s", -0.1),
    ],
)
def test_invalid_multiset_vps_client_config_is_rejected(field: str, value: object) -> None:
    with pytest.raises(ValueError):
        _config(**{field: value})


@pytest.mark.parametrize(
    ("client_id", "client_secret"),
    [
        ("", "secret"),
        ("  ", "secret"),
        ("id", ""),
        ("id", "  "),
    ],
)
def test_empty_credentials_are_rejected(client_id: str, client_secret: str) -> None:
    with pytest.raises(ValueError):
        MultisetVpsClient(
            config=_config(),
            client_id=client_id,
            client_secret=client_secret,
        )
