"""dimos-xr: XR bridge package for DimOS."""

from typing import Any

__all__ = ["XRBridge", "XRBridgeConfig", "Go2AdapterModule", "G1AdapterModule"]


def __getattr__(name: str) -> Any:
    if name == "XRBridge":
        from dimos_xr.xr_bridge_module import XRBridge

        return XRBridge
    if name == "XRBridgeConfig":
        from dimos_xr.xr_bridge_module import XRBridgeConfig

        return XRBridgeConfig
    if name == "Go2AdapterModule":
        from dimos_xr.adapters.go2 import Go2AdapterModule

        return Go2AdapterModule
    if name == "G1AdapterModule":
        from dimos_xr.adapters.g1 import G1AdapterModule

        return G1AdapterModule
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
