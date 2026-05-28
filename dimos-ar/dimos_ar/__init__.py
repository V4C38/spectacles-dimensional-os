"""dimos-ar: AR extension package for DimOS."""

from typing import Any

__all__ = ["ARBridge", "ARBridgeConfig"]


def __getattr__(name: str) -> Any:
    if name == "ARBridge":
        from dimos_ar.bridge_module import ARBridge

        return ARBridge
    if name == "ARBridgeConfig":
        from dimos_ar.bridge_module import ARBridgeConfig

        return ARBridgeConfig
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
