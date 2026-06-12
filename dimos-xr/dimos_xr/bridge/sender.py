"""BridgeSender — thin indirection layer between collaborators and XRWebSocketServer.

Created before XRWebSocketServer (which needs handler callbacks from the
collaborators that in turn need to send). Bound to the server after
construction via ``bind()``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from websockets.asyncio.server import ServerConnection

    from dimos_xr.network.websocket_server import XRWebSocketServer


class BridgeSender:
    """Decouples collaborator classes from the WebSocket server lifecycle.

    All collaborators receive a ``BridgeSender`` at construction time.
    ``XRWebSocketServer`` is created later; ``bind()`` wires the two together
    after the server is built.
    """

    def __init__(self) -> None:
        self._server: XRWebSocketServer | None = None

    def bind(self, server: XRWebSocketServer) -> None:
        self._server = server

    def send(self, payload: str) -> None:
        if self._server is not None:
            self._server.schedule_send(payload)

    def send_binary(self, payload: bytes) -> None:
        if self._server is not None:
            self._server.schedule_send_binary(payload)

    def send_to(self, websocket: ServerConnection, payload: str) -> None:
        if self._server is not None:
            self._server.schedule_send_to(websocket, payload)
