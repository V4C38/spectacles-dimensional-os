"""Native-process fences for trusted ARModule manipulation dispatch.

The WebSocket owner injects these fields after validating the source connection.
They are not client claims. Monotonic deadlines share the same host clock across
DimOS workers. Runtime control code remains independent of the AR coordinator.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import time
from typing import Any


@dataclass(frozen=True)
class ManipulationAdmission:
    epoch: str
    lease: str | None
    revision: int
    target_revision: int
    deadline: float


class ManipulationAuthorityFence:
    def __init__(self) -> None:
        self.epoch: str | None = None
        self.revision = -1
        self.lease: str | None = None
        self.target_revision = -1
        self.revoked_through = -1

    def admit(self, request: dict[str, Any]) -> ManipulationAdmission | None:
        if "authority_epoch" not in request:
            return None  # Standalone native callers; ARModule always supplies its envelope.
        epoch = request.get("authority_epoch")
        lease = request.get("authority_lease")
        revision = request.get("authority_revision")
        target = request.get("target_revision")
        deadline = request.get("authority_deadline")
        if (
            not isinstance(epoch, str)
            or not epoch
            or (lease is not None and (not isinstance(lease, str) or not lease))
            or isinstance(revision, bool)
            or not isinstance(revision, int)
            or revision < 0
            or isinstance(target, bool)
            or not isinstance(target, int)
            or target < 0
            or isinstance(deadline, bool)
            or not isinstance(deadline, (float, int))
            or not math.isfinite(deadline)
            or deadline <= time.monotonic()
        ):
            raise ValueError("invalid or expired manipulation authority")
        if revision < self.revision or revision <= self.revoked_through:
            raise ValueError("manipulation authority retired")
        if revision == self.revision and (
            epoch != self.epoch or lease != self.lease or target != self.target_revision
        ):
            raise ValueError("manipulation authority revision changed")
        self.epoch, self.revision, self.lease = epoch, revision, lease
        self.target_revision = target
        return ManipulationAdmission(epoch, lease, revision, target, float(deadline))

    def current(self, admission: ManipulationAdmission, *, planning: bool = False) -> bool:
        # A checked plan can finish after editing release, provided no target or
        # reference changed. Live commands require the exact current lease.
        return bool(
            admission.epoch == self.epoch
            and admission.target_revision == self.target_revision
            and (
                planning
                or (
                    admission.lease == self.lease
                    and admission.revision > self.revoked_through
                    and time.monotonic() < admission.deadline
                )
            )
        )

    def revoke(self, epoch: str, lease: str, revision: int) -> bool:
        if self.epoch is None:
            # Revocation can beat the first command through independent RPC
            # workers. Keep its tombstone so that queued old work cannot start.
            self.epoch = epoch
            self.revision = revision
            self.revoked_through = revision
            return True
        if epoch != self.epoch or revision < self.revision:
            return False
        was_current = self.lease == lease
        self.revision = revision
        self.revoked_through = revision
        if was_current:
            self.lease = None
        return True

    def stop(self, epoch: str, revision: int) -> None:
        if not epoch or isinstance(revision, bool) or revision < 0:
            raise ValueError("invalid stop authority")
        if self.epoch is None:
            self.epoch = epoch
        if self.epoch == epoch:
            self.revision = max(self.revision, revision)
            self.revoked_through = max(self.revoked_through, revision)
            self.lease = None
