from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from aiohttp import web
import pytest
import pytest_asyncio

from dimos.ar.localization.vps.multiset_client import MultisetVpsClient, MultisetVpsClientConfig
from dimos.ar.localization.vps.test_multiset_client import _intrinsics


@pytest_asyncio.fixture
async def vendor():
    requests = []
    entered = asyncio.Event()
    release = asyncio.Event()
    options = SimpleNamespace(block=False, unauthorized=False, delay=0.0)

    async def token(request):
        requests.append((request.path, request.headers.get("Authorization"), None))
        await asyncio.sleep(options.delay)
        return web.json_response(
            {
                "token": f"jwt-{len(requests)}",
                "expiresOn": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
            }
        )

    async def query(request):
        fields = {}
        reader = await request.multipart()
        async for part in reader:
            fields[part.name] = bytes(await part.read()) if part.filename else await part.text()
        requests.append((request.path, request.headers.get("Authorization"), fields))
        entered.set()
        if options.block:
            await release.wait()
        await asyncio.sleep(options.delay)
        if options.unauthorized:
            options.unauthorized = False
            return web.json_response({"error": "expired"}, status=401)
        return web.json_response({"poseFound": False})

    app = web.Application()
    app.router.add_post("/v1/m2m/token", token)
    app.router.add_post("/v1/vps/map/query-form", query)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    try:
        yield SimpleNamespace(
            base=f"http://127.0.0.1:{port}/v1",
            requests=requests,
            entered=entered,
            release=release,
            options=options,
        )
    finally:
        release.set()
        await runner.cleanup()


def _client(vendor, timeout=1.0):
    return MultisetVpsClient(
        config=MultisetVpsClientConfig(
            map_code="MAP_TEST", api_base=vendor.base, timeout_s=timeout
        ),
        client_id="test-id",
        client_secret="test-secret",
    )


async def test_real_multipart_preserves_api_prefix_intrinsics_and_auth_refresh(vendor) -> None:
    client = _client(vendor)
    vendor.options.unauthorized = True
    try:
        assert await client.query(jpeg=b"jpeg-bytes", intrinsics=_intrinsics()) is None
        assert [path for path, _, _ in vendor.requests] == [
            "/v1/m2m/token",
            "/v1/vps/map/query-form",
            "/v1/m2m/token",
            "/v1/vps/map/query-form",
        ]
        for _path, authorization, fields in vendor.requests:
            if fields is not None:
                assert authorization.startswith("Bearer jwt-")
                assert fields["isRightHanded"] == "true"
                assert fields["mapCode"] == "MAP_TEST"
                assert fields["queryImage"] == b"jpeg-bytes"
                assert fields["fx"] == "669.53"
            else:
                assert authorization.startswith("Basic ")
        await client.query(jpeg=b"jpeg-bytes", intrinsics=_intrinsics())
        assert len(vendor.requests) == 5  # Token reuse after refresh.
    finally:
        await client.close()
    assert client._session is None


async def test_cancellation_aborts_inflight_http_and_closes_session(vendor) -> None:
    vendor.options.block = True
    client = _client(vendor)
    task = asyncio.create_task(client.query(jpeg=b"jpeg-bytes", intrinsics=_intrinsics()))
    try:
        await asyncio.wait_for(vendor.entered.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        await client.close()
        vendor.release.set()
    assert client._session is None


async def test_aggregate_http_deadline_includes_authentication(vendor) -> None:
    vendor.options.delay = 0.06
    client = _client(vendor, timeout=0.1)
    try:
        with pytest.raises(TimeoutError):
            await client.query(jpeg=b"jpeg-bytes", intrinsics=_intrinsics())
        assert len(vendor.requests) == 2
    finally:
        await client.close()
