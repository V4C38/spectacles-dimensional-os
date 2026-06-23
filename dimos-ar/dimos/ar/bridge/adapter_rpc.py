"""Shared adapter RPC helpers for bridge collaborators.

Adapter methods are DimOS RPC proxy calls and may block. WebSocket inbound
handlers and state-machine locks must not call them directly. Use
``call_with_timeout`` when the caller needs the result, and wrap it in
``run_in_thread`` for fire-and-forget side effects such as velocity commands.
"""

from __future__ import annotations

from collections.abc import Callable
import threading
from typing import Any

from dimos.utils.logging_config import setup_logger

logger = setup_logger()


def call_with_timeout(
    adapter: object,
    method_name: str,
    *args: object,
    timeout_s: float,
) -> tuple[Any | None, BaseException | None]:
    """Call an adapter method on a daemon thread and wait up to ``timeout_s``."""
    done = threading.Event()
    result: dict[str, Any | BaseException] = {}

    def invoke() -> None:
        try:
            result["value"] = getattr(adapter, method_name)(*args)
        except BaseException as exc:  # pragma: no cover - defensive thread boundary
            result["error"] = exc
        finally:
            done.set()

    threading.Thread(
        target=invoke,
        name=f"ARBridge-{method_name}",
        daemon=True,
    ).start()
    if not done.wait(timeout_s):
        return None, None
    error = result.get("error")
    if isinstance(error, BaseException):
        return None, error
    return result.get("value"), None


def run_in_thread(fn: Callable[[], None], *, name: str) -> None:
    """Run a side-effect callback on a daemon thread."""

    def invoke() -> None:
        try:
            fn()
        except Exception:
            logger.exception("adapter RPC background task failed", task=name)

    threading.Thread(target=invoke, name=name, daemon=True).start()
