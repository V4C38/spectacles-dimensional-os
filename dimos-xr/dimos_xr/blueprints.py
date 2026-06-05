from __future__ import annotations

from dimos.core.coordination.blueprints import autoconnect

from dimos_xr.adapter_module import XRRobotAdapterModule
from dimos_xr.bridge_module import XRBridge

dimos_xr = autoconnect(
    XRRobotAdapterModule.blueprint(),
    XRBridge.blueprint(),
)
