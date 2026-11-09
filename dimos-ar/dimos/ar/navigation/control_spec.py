"""Optional repository-owned native navigation control admission port."""
from typing import Protocol

from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.spec.utils import Spec


class ARNavigationControlSpec(Spec, Protocol):  # type: ignore[misc]
    def ar_navigation_heartbeat(self, epoch: str, revision: int, deadline: float) -> bool: ...

    def ar_navigation_goal(
        self, goal: PoseStamped, epoch: str, revision: int, deadline: float
    ) -> bool: ...

    def ar_navigation_recover(self, epoch: str, revision: int, deadline: float) -> bool: ...
