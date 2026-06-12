#!/usr/bin/env python3
"""Phase 0 validation harness: standalone WebSocket server for camera_frame round-trip.

Run on the Mac while a Spectacles Lens (or test client) sends binary camera_frame
messages. Logs JPEG decode success, size, latency, and optional AprilTag detection.

Usage:
    python scripts/frame_probe.py [--port 8787]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from typing import TYPE_CHECKING

import cv2
import numpy as np
from websockets.asyncio.server import serve

from dimos_xr.tracking.tag_tracker import create_apriltag_detector, parse_camera_frame

if TYPE_CHECKING:
    import websockets

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("frame_probe")


async def handler(websocket: websockets.ServerConnection) -> None:
    logger.info("Client connected from %s", websocket.remote_address)
    frame_count = 0
    async for message in websocket:
        if isinstance(message, str):
            try:
                data = json.loads(message)
                logger.info("JSON: type=%s", data.get("type"))
            except json.JSONDecodeError:
                logger.warning("Malformed JSON text frame")
            continue
        if not isinstance(message, bytes):
            continue
        try:
            header, jpeg = parse_camera_frame(message)
        except ValueError as exc:
            logger.warning("Bad camera_frame: %s", exc)
            continue
        frame_count += 1
        frame_age = float(header.get("send_ts", 0)) - float(header.get("ts", 0))
        gray = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            logger.error("Frame %d: JPEG decode failed (%d bytes)", frame_count, len(jpeg))
            continue
        h, w = gray.shape[:2]
        logger.info(
            "Frame %d: seq=%s %dx%d jpeg=%dKB age=%.3fs",
            frame_count,
            header.get("seq"),
            w,
            h,
            len(jpeg) // 1024,
            frame_age,
        )
        detector = create_apriltag_detector()
        _corners, ids, _ = detector.detectMarkers(gray)
        if ids is not None and len(ids) > 0:
            tag_id = int(ids[0][0])
            logger.info("  Detected tag id=%d", tag_id)
        else:
            logger.info("  No tag detected in frame")


async def main(port: int) -> None:
    logger.info("Frame probe listening on ws://0.0.0.0:%d", port)
    async with serve(handler, "0.0.0.0", port, max_size=8 * 1024 * 1024):
        await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    asyncio.run(main(args.port))
