from __future__ import annotations

from typing import ClassVar

from dimos_lcm.std_msgs import Bool, String

from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class ARModuleConfig(ModuleConfig):  # type: ignore[misc]
    port: int = 8787


class ARModule(Module):  # type: ignore[misc]
    dedicated_worker: ClassVar[bool] = True

    lidar: In[PointCloud2]
    odom: In[PoseStamped]
    path: In[Path]
    goal_reached: In[Bool]
    navigation_state: In[String]

    goal_request: Out[PoseStamped]
    stop_movement: Out[Bool]

    config: ARModuleConfig

    @rpc
    def build(self) -> None:
        super().build()
        logger.info("ARModule build complete")

    @rpc
    def start(self) -> None:
        super().start()
        host = global_config.listen_host
        logger.info("ARModule started", websocket=f"ws://{host}:{self.config.port}")

    @rpc
    def stop(self) -> None:
        logger.info("ARModule stopping")
        super().stop()

    async def handle_lidar(self, msg: PointCloud2) -> None:
        del msg

    async def handle_odom(self, msg: PoseStamped) -> None:
        del msg

    async def handle_path(self, msg: Path) -> None:
        del msg

    async def handle_goal_reached(self, msg: Bool) -> None:
        del msg

    async def handle_navigation_state(self, msg: String) -> None:
        del msg
