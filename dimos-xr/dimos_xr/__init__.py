"""dimos-xr: XR bridge package for DimOS."""

from typing import Any

__all__ = ["XRBridge", "XRBridgeConfig", "XRRobotAdapterModule", "XRRobotAdapterConfig"]


def __getattr__(name: str) -> Any:
    if name == "XRBridge":
        from dimos_xr.bridge_module import XRBridge

        return XRBridge
    if name == "XRBridgeConfig":
        from dimos_xr.bridge_module import XRBridgeConfig

        return XRBridgeConfig
    if name == "XRRobotAdapterModule":
        from dimos_xr.adapter_module import XRRobotAdapterModule

        return XRRobotAdapterModule
    if name == "XRRobotAdapterConfig":
        from dimos_xr.adapter_module import XRRobotAdapterConfig

        return XRRobotAdapterConfig
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
