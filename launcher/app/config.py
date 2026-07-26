"""Launcher-local .env persistence (launcher/.env)."""

from __future__ import annotations

import os
import re
from pathlib import Path

_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_LEGACY_ENV_KEYS = ("OPENAI_API_KEY", "ROBOT_IP")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def launcher_dir(root: Path | None = None) -> Path:
    return (root or repo_root()) / "launcher"


def env_path(root: Path | None = None) -> Path:
    return launcher_dir(root) / ".env"


def scripts_dir(root: Path | None = None) -> Path:
    return launcher_dir(root) / "scripts"


def migrate_legacy_env(root: Path | None = None) -> None:
    """One-time copy of launcher keys from repo-root .env into launcher/.env."""
    target = env_path(root)
    if target.is_file():
        return
    legacy = (root or repo_root()) / ".env"
    if not legacy.is_file():
        return
    values = read_env(legacy)
    updates = {k: values[k] for k in _LEGACY_ENV_KEYS if values.get(k)}
    if updates:
        merge_env(updates, target)


def read_env(path: Path | None = None) -> dict[str, str]:
    """Parse KEY=VALUE lines; ignore comments and blank lines."""
    target = path or env_path()
    values: dict[str, str] = {}
    if not target.is_file():
        return values
    for raw in target.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not _KEY_RE.match(key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key] = value
    return values


def merge_env(updates: dict[str, str | None], path: Path | None = None) -> None:
    """Merge keys into .env without truncating unrelated lines.

    A value of None removes the key. Empty string writes KEY=.
    """
    target = path or env_path()
    existing_lines: list[str] = []
    if target.is_file():
        existing_lines = target.read_text(encoding="utf-8").splitlines()

    seen: set[str] = set()
    out: list[str] = []
    for line in existing_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            out.append(line)
            continue
        key = stripped.partition("=")[0].strip()
        if key in updates:
            seen.add(key)
            new_val = updates[key]
            if new_val is None:
                continue
            out.append(f"{key}={new_val}")
        else:
            out.append(line)

    for key, new_val in updates.items():
        if key in seen or new_val is None:
            continue
        if not _KEY_RE.match(key):
            raise ValueError(f"invalid env key: {key!r}")
        out.append(f"{key}={new_val}")

    target.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(out)
    if text and not text.endswith("\n"):
        text += "\n"
    target.write_text(text, encoding="utf-8")
    os.chmod(target, 0o600)
