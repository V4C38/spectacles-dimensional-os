"""Optional integration contract; importing ARModule requires no arm extras."""

from __future__ import annotations

from typing import Any, Protocol

from dimos.spec.utils import Spec


class ARManipulationSpec(Spec, Protocol):  # type: ignore[misc]
    def ar_manipulation_command(
        self, client_id: str, request: dict[str, Any]
    ) -> dict[str, Any]: ...

    def ar_manipulation_snapshot(self) -> dict[str, Any]: ...

    def ar_manipulation_disconnect(self, client_id: str) -> None: ...

    def ar_manipulation_stop(self) -> None: ...
