from __future__ import annotations

import asyncio
import base64
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
import math
import os
from urllib.parse import urljoin

import aiohttp
import numpy as np

from dimos.ar.localization.types import Intrinsics
from dimos.ar.localization.vps.localizer import VpsQueryResult
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.utils.transform_utils import matrix_to_pose, pose_to_matrix

_CLIENT_ID_ENV = "MULTISET_CLIENT_ID"
_CLIENT_SECRET_ENV = "MULTISET_CLIENT_SECRET"
_DEFAULT_API_BASE = "https://api.multiset.ai/v1"
_DEFAULT_AUTH_PATH = "/m2m/token"
_DEFAULT_QUERY_PATH = "/vps/map/query-form"
_QUERY_MODE = "vps-1"
_TOKEN_REFRESH_MARGIN_S = 60.0
_QUAT_NORM_EPS = 1e-9

# Rx(+90°): MultiSet right-handed Y-up map -> canonical right-handed Z-up map.
_T_ZUP_YUP = np.array(
    [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, -1.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ],
    dtype=np.float64,
)
# Vendor AR-style camera (+Y up, -Z forward) -> camera_optical (+Y down, +Z forward).
_T_CAM_CAMOPT = np.diag([1.0, -1.0, -1.0, 1.0]).astype(np.float64)


class MultisetVpsError(Exception):
    pass


class MultisetVpsAuthError(MultisetVpsError):
    pass


@dataclass(frozen=True)
class MultisetVpsClientConfig:
    map_code: str
    api_base: str = _DEFAULT_API_BASE
    auth_path: str = _DEFAULT_AUTH_PATH
    query_path: str = _DEFAULT_QUERY_PATH
    timeout_s: float = 12.0
    token_refresh_margin_s: float = _TOKEN_REFRESH_MARGIN_S

    def __post_init__(self) -> None:
        if not self.map_code.strip():
            raise ValueError("map_code must be a non-empty string")
        if not self.api_base.strip():
            raise ValueError("api_base must be a non-empty string")
        if not self.auth_path.startswith("/"):
            raise ValueError(f"auth_path must start with '/', got {self.auth_path!r}")
        if not self.query_path.startswith("/"):
            raise ValueError(f"query_path must start with '/', got {self.query_path!r}")
        if not math.isfinite(self.timeout_s) or self.timeout_s <= 0.0:
            raise ValueError(f"timeout_s must be finite and positive, got {self.timeout_s}")
        if not math.isfinite(self.token_refresh_margin_s) or self.token_refresh_margin_s < 0.0:
            raise ValueError(
                "token_refresh_margin_s must be finite and non-negative, "
                f"got {self.token_refresh_margin_s}"
            )


class MultisetVpsClient:
    def __init__(
        self,
        *,
        config: MultisetVpsClientConfig,
        client_id: str,
        client_secret: str,
        admit: Callable[[], None] | None = None,
    ) -> None:
        if not client_id.strip():
            raise ValueError("client_id must be a non-empty string")
        if not client_secret.strip():
            raise ValueError("client_secret must be a non-empty string")
        self._admit = admit
        self._config = config
        self._client_id = client_id
        self._client_secret = client_secret
        self._session: aiohttp.ClientSession | None = None
        self._lock = asyncio.Lock()
        self._token: str | None = None
        self._token_expires = 0.0

    @classmethod
    def from_env(
        cls, config: MultisetVpsClientConfig, *, admit: Callable[[], None] | None = None
    ) -> MultisetVpsClient:
        client_id = os.environ.get(_CLIENT_ID_ENV, "").strip()
        client_secret = os.environ.get(_CLIENT_SECRET_ENV, "").strip()
        missing = [
            name
            for name, value in (
                (_CLIENT_ID_ENV, client_id),
                (_CLIENT_SECRET_ENV, client_secret),
            )
            if not value
        ]
        if missing:
            raise ValueError(
                "MultiSet VPS credentials are not configured: " + ", ".join(missing) + " missing"
            )
        return cls(config=config, client_id=client_id, client_secret=client_secret, admit=admit)

    async def query(self, *, jpeg: bytes, intrinsics: Intrinsics) -> VpsQueryResult | None:
        _validate_query(jpeg, intrinsics)
        async with asyncio.timeout(self._config.timeout_s):
            async with self._lock:
                payload = await self._query_with_retry(jpeg=jpeg, intrinsics=intrinsics)
        return _result_from_payload(payload)

    async def _query_with_retry(self, *, jpeg: bytes, intrinsics: Intrinsics) -> dict[str, object]:
        token = await self._bearer()
        status, payload, text = await self._post_query(token, jpeg=jpeg, intrinsics=intrinsics)
        if status == 401:
            token = await self._bearer(force_refresh=True)
            status, payload, text = await self._post_query(token, jpeg=jpeg, intrinsics=intrinsics)
            if status == 401:
                raise MultisetVpsAuthError("MultiSet VPS query returned 401 after token refresh")
        if status != 200:
            detail = text[:300] if text else ""
            raise MultisetVpsError(
                f"POST {self._config.query_path} failed with HTTP {status}: {detail}"
            )
        if not isinstance(payload, dict):
            raise MultisetVpsError(
                f"MultiSet VPS query returned a non-object JSON payload: {payload!r}"
            )
        return payload

    async def _bearer(self, *, force_refresh: bool = False) -> str:
        now = _utc_now()
        if (
            not force_refresh
            and self._token is not None
            and now < self._token_expires - self._config.token_refresh_margin_s
        ):
            return self._token
        token, expires = await self._fetch_token()
        self._token = token
        self._token_expires = expires
        return token

    async def _fetch_token(self) -> tuple[str, float]:
        headers = {"Authorization": f"Basic {_basic_token(self._client_id, self._client_secret)}"}
        status, payload, text = await self._post(self._auth_url(), headers=headers)
        if status != 200:
            detail = text[:300] if text else ""
            raise MultisetVpsAuthError(
                f"POST {self._config.auth_path} failed with HTTP {status}: {detail}"
            )
        if not isinstance(payload, dict):
            raise MultisetVpsAuthError(
                f"MultiSet token endpoint returned a non-object JSON payload: {payload!r}"
            )
        error = payload.get("error")
        if error:
            raise MultisetVpsAuthError(f"MultiSet auth failed: {error}")
        token = payload.get("token")
        expires_on = payload.get("expiresOn")
        if not isinstance(token, str) or not token.strip():
            raise MultisetVpsAuthError("MultiSet token response is missing token")
        if not isinstance(expires_on, str) or not expires_on.strip():
            raise MultisetVpsAuthError("MultiSet token response is missing expiresOn")
        return token, parse_expires_on(expires_on)

    async def _post_query(
        self,
        token: str,
        *,
        jpeg: bytes,
        intrinsics: Intrinsics,
    ) -> tuple[int, object, str]:
        headers = {"Authorization": f"Bearer {token}"}
        data = {
            "mapCode": self._config.map_code,
            "fx": _form_float(intrinsics.fx),
            "fy": _form_float(intrinsics.fy),
            "px": _form_float(intrinsics.cx),
            "py": _form_float(intrinsics.cy),
            "width": str(intrinsics.width),
            "height": str(intrinsics.height),
            "isRightHanded": "true",
            "queryMode": _QUERY_MODE,
        }
        files = {"queryImage": ("query.jpg", jpeg, "image/jpeg")}
        if self._admit is not None:
            self._admit()
        return await self._post(self._query_url(), headers=headers, data=data, files=files)

    async def _post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        data: dict[str, str] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
    ) -> tuple[int, object, str]:
        if self._session is None:
            # Construct and close on the module event loop, not in build's RPC thread.
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self._config.timeout_s, sock_connect=3.0),
            )
        form = None
        if data is not None or files is not None:
            form = aiohttp.FormData()
            for name, value in (data or {}).items():
                form.add_field(name, value)
            for name, (filename, payload, content_type) in (files or {}).items():
                form.add_field(name, payload, filename=filename, content_type=content_type)
        try:
            async with self._session.post(url, headers=headers, data=form) as response:
                text = await response.text()
                if response.status == 401:
                    return 401, None, text
                try:
                    body = await response.json(content_type=None)
                except ValueError as exc:
                    if response.status != 200:
                        return response.status, None, text
                    raise MultisetVpsError("MultiSet HTTP response was not JSON") from exc
                return response.status, body, text
        except aiohttp.ClientError as exc:
            raise MultisetVpsError(f"MultiSet HTTP request failed: {type(exc).__name__}") from exc

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    def _auth_url(self) -> str:
        return _join_url(self._config.api_base, self._config.auth_path)

    def _query_url(self) -> str:
        return _join_url(self._config.api_base, self._config.query_path)


def _utc_now() -> float:
    return datetime.now(tz=UTC).timestamp()


def parse_expires_on(value: str) -> float:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise MultisetVpsAuthError(f"MultiSet expiresOn is not ISO-8601: {value!r}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.timestamp()


def map_camopt_from_vendor_pose(pose: Pose) -> Pose:
    P_vendor_cam = np.asarray(pose_to_matrix(pose), dtype=np.float64)
    P_map_camopt = _T_ZUP_YUP @ P_vendor_cam @ _T_CAM_CAMOPT
    if not np.isfinite(P_map_camopt).all():
        raise MultisetVpsError("vendor pose converted to a non-finite camera_optical pose")
    return matrix_to_pose(P_map_camopt)


def _validate_query(jpeg: bytes, intrinsics: Intrinsics) -> None:
    if not jpeg:
        raise ValueError("jpeg must be non-empty")
    if intrinsics.distortion_model != "none":
        raise ValueError(
            "MultiSet VPS queries require pinhole intrinsics, "
            f"got distortion_model={intrinsics.distortion_model!r}"
        )
    if intrinsics.width <= 0 or intrinsics.height <= 0:
        raise ValueError(
            f"intrinsics width and height must be positive, got {intrinsics.width}x{intrinsics.height}"
        )
    for name, value in (
        ("fx", intrinsics.fx),
        ("fy", intrinsics.fy),
        ("cx", intrinsics.cx),
        ("cy", intrinsics.cy),
    ):
        if not math.isfinite(value):
            raise ValueError(f"intrinsics.{name} must be finite, got {value}")


def _result_from_payload(payload: dict[str, object]) -> VpsQueryResult | None:
    pose_found = payload.get("poseFound")
    if not isinstance(pose_found, bool):
        raise MultisetVpsError("MultiSet VPS response is missing boolean poseFound")
    if not pose_found:
        return None

    position = _xyz(payload.get("position"), "position")
    rotation = _xyzw(payload.get("rotation"), "rotation")
    confidence = _require_finite_float(payload.get("confidence"), "confidence")
    if not 0.0 <= confidence <= 1.0:
        raise MultisetVpsError(f"MultiSet VPS confidence is outside [0, 1], got {confidence}")

    vendor_pose = Pose(*position, *rotation)
    return VpsQueryResult(
        camera_pose=map_camopt_from_vendor_pose(vendor_pose),
        confidence=confidence,
    )


def _xyz(value: object, name: str) -> tuple[float, float, float]:
    if not isinstance(value, dict):
        raise MultisetVpsError(f"MultiSet VPS response is missing object {name}")
    return (
        _require_finite_float(value.get("x"), f"{name}.x"),
        _require_finite_float(value.get("y"), f"{name}.y"),
        _require_finite_float(value.get("z"), f"{name}.z"),
    )


def _xyzw(value: object, name: str) -> tuple[float, float, float, float]:
    if not isinstance(value, dict):
        raise MultisetVpsError(f"MultiSet VPS response is missing object {name}")
    quaternion = (
        _require_finite_float(value.get("x"), f"{name}.x"),
        _require_finite_float(value.get("y"), f"{name}.y"),
        _require_finite_float(value.get("z"), f"{name}.z"),
        _require_finite_float(value.get("w"), f"{name}.w"),
    )
    norm = math.sqrt(sum(component * component for component in quaternion))
    if norm <= _QUAT_NORM_EPS:
        raise MultisetVpsError(f"MultiSet VPS {name} is a zero quaternion")
    return quaternion


def _require_finite_float(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise MultisetVpsError(f"MultiSet VPS {name} must be a finite number, got {value!r}")
    number = float(value)
    if not math.isfinite(number):
        raise MultisetVpsError(f"MultiSet VPS {name} must be a finite number, got {number}")
    return number


def _basic_token(client_id: str, client_secret: str) -> str:
    return base64.b64encode(f"{client_id}:{client_secret}".encode()).decode("ascii")


def _form_float(value: float) -> str:
    return format(value, ".16g")


def _join_url(api_base: str, path: str) -> str:
    return urljoin(api_base.rstrip("/") + "/", path.lstrip("/"))
