"""Optional integration contract; importing ARModule requires no arm extras."""

from __future__ import annotations

from typing import Any, Protocol

from dimos.spec.utils import Spec


class ARManipulationSpec(Spec, Protocol):  # type: ignore[misc]
    def ar_manipulation_command(
        self, client_id: str, request: dict[str, Any]
    ) -> dict[str, Any]: ...

    def ar_manipulation_evaluate_following(
        self, client_id: str, request: dict[str, Any]
    ) -> dict[str, Any]: ...

    def ar_manipulation_snapshot(self) -> dict[str, Any]: ...

    def ar_manipulation_disconnect(self, client_id: str) -> None: ...

    def ar_manipulation_suspend(self, client_id: str, deadline: float) -> None: ...

    def ar_manipulation_stop(
        self, epoch: str | None = None, revision: int | None = None
    ) -> None: ...

    def ar_manipulation_revoke(
        self, epoch: str, lease_id: str, revision: int, reason: str = "released"
    ) -> None: ...

    def ar_manipulation_heartbeat(self, epoch: str, revision: int, deadline: float) -> None: ...

    def ar_manipulation_asset(self, kind: str, revision: str) -> dict[str, Any] | None: ...
