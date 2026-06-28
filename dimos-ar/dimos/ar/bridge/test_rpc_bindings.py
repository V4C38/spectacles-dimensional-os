"""Test helpers for binding mock adapter methods to dispatch_adapter_nowait."""

from __future__ import annotations

import threading
from typing import Any
from unittest.mock import MagicMock

_MOTION_METHODS = (
    "send_joystick_command",
    "send_nav_goal",
    "cancel_nav_goal",
    "emergency_stop",
)


def bind_mock_adapter_rpc(
    adapter: MagicMock,
    *,
    remote_name: str = "test_adapter",
    async_dispatch: bool = False,
) -> None:
    """Attach DimOS RpcCall metadata to mock adapter methods."""

    def call_nowait(name: str, arguments: tuple[tuple[Any, ...], dict[str, Any]]) -> None:
        args, kwargs = arguments
        method_name = name.rsplit("/", 1)[-1]
        target = getattr(adapter, method_name)

        def invoke() -> None:
            target(*args, **kwargs)

        if async_dispatch:
            threading.Thread(
                target=invoke,
                daemon=True,
                name=f"mock-rpc-{method_name}",
            ).start()
        else:
            invoke()

    rpc = MagicMock()
    rpc.call_nowait = call_nowait
    for method in _MOTION_METHODS:
        fn = getattr(adapter, method)
        fn._rpc = rpc
        fn._remote_name = remote_name
        fn._name = method
