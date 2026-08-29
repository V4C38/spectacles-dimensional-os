from __future__ import annotations

from collections.abc import Callable, Sequence

from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class Safety:
    def __init__(
        self,
        *,
        estop_available: bool,
        effects: Sequence[Callable[[], bool]],
    ) -> None:
        self._estop_available = estop_available
        self._effects = tuple(effects)

    def on_estop_request(self) -> bool:
        return self._run(reason="request")

    def on_last_disconnect(self) -> bool:
        return self._run(reason="last_disconnect")

    def _run(self, *, reason: str) -> bool:
        if not self._estop_available:
            return False
        logger.info("estop", reason=reason)
        changed = False
        for effect in self._effects:
            if effect():
                changed = True
        return changed
