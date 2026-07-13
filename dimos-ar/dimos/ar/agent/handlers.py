"""Agent inbound handlers — fire-and-forget stubs for protocol v17."""

from __future__ import annotations

from dimos.ar.agent.wire import AgentCommandMessage, ArSkillResultMessage
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class AgentHandlers:
    """Stub agent handlers; publish/resolve only — never block the inbound lane."""

    def on_agent_command(self, msg: AgentCommandMessage) -> None:
        logger.info(
            "agent_command received (stub)",
            robot_id=msg.robot_id,
            text=msg.text[:120],
        )

    def on_ar_skill_result(self, msg: ArSkillResultMessage) -> None:
        logger.info(
            "ar_skill_result received (stub)",
            robot_id=msg.robot_id,
            request_id=msg.request_id,
            skill=msg.skill,
            ok=msg.ok,
            error=msg.error,
        )
