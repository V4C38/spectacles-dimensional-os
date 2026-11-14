from dimos.ar.navigation.control_fence import NavigationControlFence


def test_expired_planning_cannot_activate_or_resume_from_heartbeat():
    now = [1.0]
    fence = NavigationControlFence(lambda: now[0])
    generation = fence.admit("epoch", 1, 1.5, 100)
    assert generation is not None
    assert not fence.allowed()
    now[0] = 1.6
    assert not fence.activate(generation)
    assert fence.heartbeat("epoch", 2, 2.1)
    assert not fence.allowed()
    assert not fence.activate(generation)
    assert fence.expire() is not None
    replacement = fence.admit("epoch", 3, 2.1, 101)
    assert replacement is not None and fence.activate(replacement)
    assert fence.allowed()


def test_superseded_planning_and_old_epoch_cannot_replace_successor():
    fence = NavigationControlFence(lambda: 1.0)
    first = fence.admit("one", 1, 2, 100)
    second = fence.admit("two", 1, 2, 101)
    assert first is not None and second is not None
    assert not fence.activate(first)
    assert not fence.heartbeat("one", 999, 100)
    assert fence.activate(second)
    assert not fence.same_generation(first)
    assert fence.allowed()


def test_watchdog_expiry_is_once_and_stop_requires_explicit_new_admission():
    now = [1.0]
    fence = NavigationControlFence(lambda: now[0])
    generation = fence.admit("one", 1, 1.5, 100)
    assert generation is not None and fence.activate(generation)
    now[0] = 1.51
    assert not fence.allowed()
    expired = fence.expire()
    assert expired is not None and expired[1] == 100
    assert fence.expire() is None
    assert not fence.admit_native_agent()
    fence.heartbeat("one", 2, 2)
    assert not fence.allowed()
    assert fence.admit_native_agent()
    now[0] = 2.01
    assert not fence.allowed()
    assert fence.expire() is not None
    assert fence.expire() is None


def test_heartbeat_revision_does_not_discard_a_queued_goal():
    fence = NavigationControlFence(lambda: 1.0)
    assert fence.heartbeat("epoch", 50, 1.5)
    generation = fence.admit("epoch", 42, 1.5, 100)
    assert generation is not None and fence.activate(generation)
    assert fence.heartbeat("epoch", 100, 1.6)
    assert fence.allowed()
    assert fence.admit("epoch", 41, 1.6, 99) is None


def test_manual_agent_latch_blocks_raw_goals_but_allows_explicit_manual_admission():
    fence = NavigationControlFence(lambda: 1.0)
    old = fence.admit_native_agent()
    assert old is not None and fence.activate(old)
    fence.set_agent_manual(True)
    assert not fence.allowed()
    assert fence.admit_native_agent() is None
    assert not fence.activate(old)
    manual = fence.admit("human", 1, 2, 100)
    assert manual is not None and fence.activate(manual)
    assert fence.allowed()
    assert fence.admit_native_agent() is None
    assert fence.set_agent_manual(True, 0)
    assert fence.set_agent_manual(False, 0)
    fresh = fence.admit_native_agent()
    assert fresh is not None and fresh != old and fence.activate(fresh)
    assert fence.set_agent_manual(True, 2)
    assert not fence.set_agent_manual(False, 1)
    assert fence.admit_native_agent() is None
    assert not fence.set_agent_manual(False)
