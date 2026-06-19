"""Blueprint stream-type conflict checks — catch autoconnect wiring mistakes early."""

from __future__ import annotations

from dimos.core.coordination.module_coordinator import _verify_no_name_conflicts

from dimos_xr.blueprints import xr_g1


def test_xr_g1_has_no_stream_type_conflicts() -> None:
    _verify_no_name_conflicts(xr_g1)
