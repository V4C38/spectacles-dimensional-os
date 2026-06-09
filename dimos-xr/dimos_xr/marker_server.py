"""LAN HTTP server for the phone calibration board (daemon thread)."""

from __future__ import annotations

import os
import socket
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from dimos.utils.logging_config import setup_logger

from dimos_xr.marker_contract import (
    COMPOSITE_MARKER_HEIGHT_MM,
    COMPOSITE_MARKER_WIDTH_MM,
    DEFAULT_APRILTAG_DICT,
    DEFAULT_MARKER_ID,
    MARKER_PNG,
    PHONE_WEB_MARKER_DISPLAY_HEIGHT_MM,
    PHONE_WEB_MARKER_DISPLAY_WIDTH_MM,
)
from dimos_xr.marker_qr import print_marker_qr

logger = setup_logger()

DEFAULT_MARKER_PORT = 8766

_PKG_ROOT = Path(__file__).resolve().parent.parent
_MARKER_PAGE_DIR = _PKG_ROOT / "clients" / "marker"
_MARKER_PAGE_TEMPLATE = _MARKER_PAGE_DIR / "index.html"
_MARKER_PNG = _PKG_ROOT / "assets" / MARKER_PNG


def _lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return str(s.getsockname()[0])
    except OSError:
        return "127.0.0.1"


class _MarkerHandler(SimpleHTTPRequestHandler):
    """Serve marker page and board PNG."""

    def __init__(self, *args: Any, board_png: Path, **kwargs: Any) -> None:
        self._board_png = board_png
        super().__init__(*args, directory=str(_MARKER_PAGE_DIR), **kwargs)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in (f"/{MARKER_PNG}", f"/{MARKER_PNG}/"):
            if not self._board_png.is_file():
                self.send_error(404, "Marker image not found")
                return
            data = self._board_png.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path in ("/", "/index.html"):
            html = _render_marker_page().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(html)
            return
        return super().do_GET()

    def log_message(self, format: str, *args: object) -> None:
        logger.debug("marker_http " + format, *args)


def _render_marker_page() -> str:
    template = _MARKER_PAGE_TEMPLATE.read_text(encoding="utf-8")
    return (
        template.replace("__MARKER_WIDTH_MM__", f"{PHONE_WEB_MARKER_DISPLAY_WIDTH_MM:.2f}")
        .replace("__MARKER_HEIGHT_MM__", f"{PHONE_WEB_MARKER_DISPLAY_HEIGHT_MM:.2f}")
        .replace("__MARKER_DICTIONARY__", DEFAULT_APRILTAG_DICT)
        .replace("__MARKER_ID__", str(DEFAULT_MARKER_ID))
    )


class MarkerHTTPServer:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        board_png: Path | None = None,
    ) -> None:
        self._host = host
        self._port = port
        self._board_png = board_png or _MARKER_PNG
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._url: str | None = None

    def public_url(self) -> str:
        if self._url is not None:
            return self._url
        display_host = _lan_ip() if self._host in ("0.0.0.0", "") else self._host
        if display_host in ("0.0.0.0", ""):
            display_host = "127.0.0.1"
        return f"http://{display_host}:{self._port}/"

    def start(self) -> str:
        """Start server on daemon thread; return public marker URL."""
        if self._httpd is not None:
            return self.public_url()

        handler = partial(_MarkerHandler, board_png=self._board_png)
        self._httpd = ThreadingHTTPServer((self._host, self._port), handler)
        self._thread = threading.Thread(
            target=self._httpd.serve_forever,
            name="marker-http",
            daemon=True,
        )
        self._thread.start()
        self._url = self.public_url()
        logger.info(
            "AprilTag marker page listening url=%s marker=%.0fmm x %.0fmm "
            "css_display=%.2fmm x %.2fmm asset=%s",
            self._url,
            COMPOSITE_MARKER_WIDTH_MM,
            COMPOSITE_MARKER_HEIGHT_MM,
            PHONE_WEB_MARKER_DISPLAY_WIDTH_MM,
            PHONE_WEB_MARKER_DISPLAY_HEIGHT_MM,
            self._board_png,
        )
        return self._url

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None


_server: MarkerHTTPServer | None = None


def marker_port() -> int:
    raw = os.environ.get("MARKER_PORT")
    if raw is None:
        return DEFAULT_MARKER_PORT
    return int(raw)


def start_marker_server(*, host: str | None = None, print_qr: bool = True) -> str:
    """Start marker HTTP server once; print QR to terminal. Returns URL."""
    global _server
    bind = host if host is not None else os.environ.get("LISTEN_HOST", "0.0.0.0")
    if _server is None:
        _server = MarkerHTTPServer(host=bind, port=marker_port())
    url = _server.start()
    if print_qr:
        print_marker_qr(url)
    return url


def stop_marker_server() -> None:
    global _server
    if _server is not None:
        _server.stop()
        _server = None
