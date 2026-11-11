import pytest

from dimos.ar.localization.vps.admission import QueryDeferredError, VpsAdmission


def test_rolling_budget_consumes_dispatch_and_requires_fresh_recapture():
    now = [100.0]
    admission = VpsAdmission(clock=lambda: now[0], wall_clock=lambda: now[0])
    admission.capture_ts.set(100)
    for _ in range(3):
        admission.admit()
    assert admission.delay() == 30
    with pytest.raises(QueryDeferredError, match="rate_limited"):
        admission.admit()
    now[0] += 30
    assert admission.delay() == 0
    with pytest.raises(QueryDeferredError, match="fresh_capture_required"):
        admission.admit()
    admission.capture_ts.set(now[0])
    admission.admit()
    assert admission.delay() == 0
