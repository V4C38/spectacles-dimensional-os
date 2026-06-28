"""TTY-aware console dividers and selective checkpoint styling for dimos-ar logs."""

from __future__ import annotations

import os
import sys
from typing import Any, Literal, cast

CheckpointKind = Literal["default", "milestone", "success", "warn"]

_DIVIDER_WIDTH = 50
_RESET = "\033[0m"
_BOLD = "\033[1m"
_DIM = "\033[2m"
_DIVIDER_RULE = "\033[0;36m"  # cyan
_DIVIDER_TITLE = "\033[1;37m"  # bold white

_STYLE_PREFIX = {
    "success": "\033[1;32m▸ ",  # bold green
    "milestone": "\033[1;36m▸ ",  # bold cyan
    "warn": "\033[1;33m▸ ",  # bold yellow
}

_AR_STYLE_KEY = "_ar_style"
_INSTALLED = False


def use_console_colors() -> bool:
    force = os.environ.get("DIMOS_AR_FORCE_COLOR", "")
    if force not in ("", "0", "false"):
        return True
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


def console_divider(title: str) -> None:
    """Print a framed section divider to stdout (dimos-ar milestones only)."""
    if use_console_colors():
        rule = f"{_DIVIDER_RULE}{'-' * _DIVIDER_WIDTH}{_RESET}"
        centered = f"{_DIVIDER_TITLE}{title}{_RESET}"
        sys.stdout.write(f"{rule}\n{centered}\n{rule}\n")
    else:
        rule = "-" * _DIVIDER_WIDTH
        sys.stdout.write(f"{rule}\n{title}\n{rule}\n")
    sys.stdout.flush()


def log_checkpoint(
    logger: Any,
    *,
    kind: CheckpointKind = "default",
    event: str,
    level: str = "info",
    **fields: object,
) -> None:
    """Emit a structured log line; styled checkpoints pass ``_ar_style`` to the console formatter."""
    payload = dict(fields)
    if kind != "default":
        payload[_AR_STYLE_KEY] = kind
    log_fn = getattr(logger, level, logger.info)
    log_fn(event, **payload)


def install_ar_console_styles() -> None:
    """Wrap DimOS ``_compact_console_processor`` to style dimos-ar checkpoint events."""
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    import logging

    import structlog

    import dimos.utils.logging_config as logging_config

    original = logging_config._compact_console_processor

    def _wrapped_processor(logger: Any, method_name: str, event_dict: dict[str, Any]) -> str:
        event_dict = dict(event_dict)
        style = event_dict.pop(_AR_STYLE_KEY, None)
        line = cast("str", original(logger, method_name, event_dict))
        if not style or not use_console_colors():
            return line
        prefix = _STYLE_PREFIX.get(str(style), "")
        if not prefix:
            return line
        # Insert styled prefix immediately after the path column: ...[inf][path...] PREFIXevent...
        marker = "] "
        idx = line.find(marker)
        if idx == -1:
            return f"{prefix}{line}{_RESET}"
        head = line[: idx + len(marker)]
        tail = line[idx + len(marker) :]
        return f"{head}{prefix}{tail}{_RESET}"

    logging_config._compact_console_processor = _wrapped_processor

    # Workers import dimos-ar modules before start.sh bootstrap; rebind existing formatters.
    processor_formatter = structlog.stdlib.ProcessorFormatter
    for logger_obj in logging.Logger.manager.loggerDict.values():
        if not isinstance(logger_obj, logging.Logger):
            continue
        for handler in logger_obj.handlers:
            formatter = handler.formatter
            if isinstance(formatter, processor_formatter):
                formatter.processor = _wrapped_processor  # type: ignore[attr-defined]


# Ensure checkpoint styling is active before dimos-ar loggers bind console formatters.
install_ar_console_styles()
