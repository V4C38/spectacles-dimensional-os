import json

import pytest

from dimos.ar.manipulation.protocol import decode_request
from dimos.ar.websocket.protocol import decode_inbound


def request(**changes):
    return {
        "type": "manipulation_request",
        "request_id": "r1",
        "action": "update",
        "group_id": "arm",
        "token": "token",
        "sequence": 1,
        "ts": 10,
        "position": [1, 2, 3],
        "orientation": [0, 0, 0, 1],
        **changes,
    }


@pytest.mark.parametrize(
    "changes",
    [
        {"position": [True, 0, 0]},
        {"position": [float("nan"), 0, 0]},
        {"orientation": [0, 0, 0, 0]},
        {"sequence": True},
        {"sequence": -1},
        {"ts": float("inf")},
        {"token": ""},
        {"action": "pick"},
        {"action": []},
        {"group_id": " "},
    ],
)
def test_rejects_invalid_motion_inputs(changes):
    with pytest.raises((TypeError, ValueError)):
        decode_request(request(**changes))


def test_websocket_dispatch_uses_validated_request():
    decoded = decode_inbound(json.dumps(request()))
    assert decoded.action == "update"
    assert decoded.payload["sequence"] == 1
    assert decoded.payload["orientation"] == [0, 0, 0, 1]
