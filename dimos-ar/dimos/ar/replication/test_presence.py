import json
from typing import Any

import pytest

from dimos.ar.replication.presence import ClientPresence, PresenceRelay, decode_cues
from dimos.ar.websocket.bulk import TokenBucket
from dimos.ar.websocket.protocol import decode_hello_request, decode_inbound

CONTEXT = {"map_code": "office", "odom_reference_id": "odom"}


def cues() -> dict[str, Any]:
    return {
        **CONTEXT,
        "pointers": [
            {
                "id": 0,
                "start": [0, 0, 0],
                "control": [0.5, 0, 0],
                "end": [1, 0, 0],
                "opacity": 0.4,
                "cursor": True,
            }
        ],
        "panel": {"position": [1, 2, 3], "orientation": [0, 0, 0, 1], "width": 0.5, "height": 0.3},
    }


def test_codec_and_optional_negotiation() -> None:
    assert isinstance(
        decode_inbound(json.dumps({"type": "client_presence", **cues()})), ClientPresence
    )
    assert not decode_hello_request(
        '{"type":"hello_request","protocol_version":2,"ts_client":0}'
    ).presence
    assert decode_hello_request(
        '{"type":"hello_request","protocol_version":2,"ts_client":0,"presence":true}'
    ).presence
    with pytest.raises(ValueError):
        decode_hello_request(
            '{"type":"hello_request","protocol_version":2,"ts_client":0,"presence":1}'
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("pointers", [None]),
        ("pointers", [cues()["pointers"][0]] * 3),
        ("map_code", ""),
        ("odom_reference_id", "x" * 129),
    ],
)
def test_rejects_invalid_cues(field: str, value: Any) -> None:
    with pytest.raises(ValueError):
        decode_cues({**cues(), field: value})


@pytest.mark.parametrize("value", [True, float("nan"), float("inf"), 10**400, -1])
def test_rejects_bad_numbers(value: Any) -> None:
    data = cues()
    data["pointers"][0]["opacity"] = value
    with pytest.raises(ValueError):
        decode_cues(data)


def test_relay_caps_updates_expires_and_removes_without_authority() -> None:
    relay = PresenceRelay(lambda: CONTEXT)
    relay.receive("one", ClientPresence(decode_cues(cues())), 0)
    relay.receive("two", ClientPresence(decode_cues(cues())), 0)
    snapshot = relay.snapshot(0)
    assert snapshot and len(snapshot["clients"]) == 2
    relay.receive("one", ClientPresence({**decode_cues(cues()), "panel": None}), 0.1)
    assert relay.snapshot(0.1) is None
    assert relay.snapshot(0.2) is None
    relay.receive("one", ClientPresence({**decode_cues(cues()), "panel": None}), 0.2)
    snapshot = relay.snapshot(0.2)
    assert snapshot and snapshot["clients"][0]["panel"] is None
    text = relay.encode(snapshot, "one", TokenBucket(16384, 16384))
    assert text and [c["client_id"] for c in json.loads(text)["clients"]] == ["two"]
    assert relay.encode(snapshot, "one", TokenBucket(1, 1)) is None
    relay.remove("one")
    assert len(relay.snapshot(0.4)["clients"]) == 1  # type: ignore[index]
    assert relay.snapshot(2)["clients"] == []  # type: ignore[index]


def test_context_reset_and_maximum_roster_remain_bounded() -> None:
    context = dict(CONTEXT)
    relay = PresenceRelay(lambda: context)
    for i in range(16):
        relay.receive(str(i), ClientPresence(decode_cues(cues())), 0)
    snapshot = relay.snapshot(0)
    assert snapshot
    text = relay.encode(snapshot, "0", TokenBucket(16384, 16384))
    assert text and len(text.encode()) < 16384
    context["odom_reference_id"] = "new"
    assert relay.snapshot(0.2)["clients"] == []  # type: ignore[index]


@pytest.mark.asyncio
async def test_real_sockets_filter_identity_keep_controls_live_and_clear_disconnect() -> None:
    import asyncio

    import websockets

    from test_support.websocket import ServerHarness, _send_hello_request

    harness = ServerHarness(presence_context=lambda: CONTEXT)
    harness.start()
    try:
        url = f"ws://127.0.0.1:{harness.port}/ws"
        async with (
            websockets.connect(url) as first,
            websockets.connect(url) as second,
            websockets.connect(url) as legacy,
        ):
            hellos = []
            for ws in (first, second):
                await ws.send(
                    json.dumps(
                        {
                            "type": "hello_request",
                            "protocol_version": 2,
                            "ts_client": 0,
                            "presence": True,
                        }
                    )
                )
                hellos.append(json.loads(await ws.recv()))
            assert hellos[0]["presence"] is True
            assert (await _send_hello_request(legacy))["presence"] is False
            await first.send(
                json.dumps({"type": "client_presence", "client_id": "spoof", **cues()})
            )
            state = json.loads(await asyncio.wait_for(second.recv(), 2))
            assert state["clients"][0]["client_id"] == hellos[0]["client_id"]
            assert json.loads(await asyncio.wait_for(first.recv(), 2))["clients"] == []
            await second.send('{"type":"state_request"}')
            assert not harness._server._connection(hellos[1]["client_id"]).retired
            await first.close()
            assert json.loads(await asyncio.wait_for(second.recv(), 2))["clients"] == []
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(legacy.recv(), 0.1)
    finally:
        harness.stop()
