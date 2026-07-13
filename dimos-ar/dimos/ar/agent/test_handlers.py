from __future__ import annotations

from dimos.ar.agent.handlers import AgentHandlers
from dimos.ar.agent.wire import AgentCommandMessage, ArSkillResultMessage


def test_agent_handlers_return_immediately() -> None:
    handlers = AgentHandlers()
    handlers.on_agent_command(
        AgentCommandMessage(ts=1.0, robot_id="unitree_go2", text="go to kitchen")
    )
    handlers.on_ar_skill_result(
        ArSkillResultMessage(
            ts=1.0,
            robot_id="unitree_go2",
            request_id="req-1",
            ok=True,
            skill="get_user_hmd_transform",
            data={"position": [0.0, 0.0, 0.0]},
        )
    )
