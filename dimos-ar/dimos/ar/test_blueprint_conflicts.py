"""Blueprint stream-type conflict checks — catch autoconnect wiring mistakes early."""

from __future__ import annotations

import pytest

from dimos.ar.blueprints import ar_g1, ar_go2
from dimos.core.coordination.module_coordinator import _verify_no_name_conflicts


def test_ar_go2_has_no_stream_type_conflicts() -> None:
    _verify_no_name_conflicts(ar_go2)


@pytest.mark.skipif(ar_g1 is None, reason="requires full DimOS install with G1 nav-onboard stack")
def test_ar_g1_has_no_stream_type_conflicts() -> None:
    _verify_no_name_conflicts(ar_g1)
