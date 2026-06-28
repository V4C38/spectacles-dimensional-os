"""Fire-and-forget adapter RPC dispatch via DimOS call_nowait."""

from __future__ import annotations

from typing import Any


def dispatch_adapter_nowait(rpc_call: Any, *args: object, **kwargs: object) -> None:
    """Dispatch one adapter RPC without blocking the caller on LCM ack."""
    rpc = getattr(rpc_call, "_rpc", None)
    remote_name = getattr(rpc_call, "_remote_name", None)
    name = getattr(rpc_call, "_name", None)
    if rpc is None:
        raise TypeError(
            f"adapter RPC dispatch requires a DimOS RpcCall with _rpc; got {type(rpc_call)!r}"
        )
    if not isinstance(remote_name, str) or not isinstance(name, str):
        raise TypeError(
            "adapter RPC dispatch requires RpcCall _remote_name and _name to be str; "
            f"got remote_name={remote_name!r} name={name!r}"
        )
    call_nowait = getattr(rpc, "call_nowait", None)
    if not callable(call_nowait):
        raise TypeError(
            f"adapter RPC {remote_name}/{name}: rpc object lacks callable call_nowait"
        )
    call_nowait(f"{remote_name}/{name}", (args, kwargs))
