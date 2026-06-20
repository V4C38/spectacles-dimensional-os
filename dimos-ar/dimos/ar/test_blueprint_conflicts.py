"""Blueprint stream-type conflict checks — catch autoconnect wiring mistakes early."""

from __future__ import annotations

from dimos.ar.blueprints import ar_g1, ar_go2
from dimos.core.coordination.module_coordinator import _verify_no_name_conflicts


@pytest.mark.skipif(ar_go2 is None, reason="requires full DimOS install with Go2 smart stack")
def test_ar_go2_has_no_stream_type_conflicts() -> None:
    _verify_no_name_conflicts(ar_go2)


def test_ar_g1_has_no_stream_type_conflicts() -> None:
    _verify_no_name_conflicts(ar_g1)
