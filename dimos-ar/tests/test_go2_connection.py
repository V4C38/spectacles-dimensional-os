from __future__ import annotations

from unittest.mock import MagicMock, patch

from dimos_ar.go2_connection import ARGO2Connection


@patch("dimos_ar.go2_connection.resolve_ip_for_serial", return_value="10.0.0.99")
@patch("dimos_ar.go2_connection.make_connection")
def test_reconnect_uses_discovered_ip(mock_make_connection, mock_resolve) -> None:
    conn = ARGO2Connection.__new__(ARGO2Connection)
    conn.config = MagicMock()
    conn.config.g = MagicMock()
    conn.config.target_serial = "SERIAL_X"
    old_connection = MagicMock()
    conn.connection = old_connection
    conn._stream_disposables = MagicMock()
    conn._stream_disposables.dispose = MagicMock()
    conn._stream_disposables.add = MagicMock()
    conn._last_lidar_mono = None
    conn._last_odom_mono = None
    conn._last_reconnect_mono = 0.0
    conn.lidar = MagicMock()
    conn.odom = MagicMock()
    conn.color_image = MagicMock()
    conn.cmd_vel = MagicMock()
    conn.move = MagicMock()
    conn._latest_video_frame = None

    new_connection = MagicMock()
    mock_make_connection.return_value = new_connection

    with patch("dimos_ar.go2_connection.global_config") as mock_gc:
        mock_gc.replay = False
        conn._reconnect("10.0.0.99")

    old_connection.stop.assert_called_once()
    mock_make_connection.assert_called_once_with("10.0.0.99", conn.config.g)
    new_connection.start.assert_called_once()
    mock_gc.update.assert_called_with(robot_ip="10.0.0.99")
