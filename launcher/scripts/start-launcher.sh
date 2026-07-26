#!/usr/bin/env bash
# Launch the Dimensional OS AR Bridge web UI (localhost).
#
# Usage:
#   ./launcher/scripts/start-launcher.sh   # from repo root
#   Double-click "Start Launcher.command" in Finder

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LAUNCHER_DIR="${ROOT}/launcher/app"
VENV_DIR="${LAUNCHER_DIR}/.venv"
VENV_PYTHON="${VENV_DIR}/bin/python"
HOST="127.0.0.1"
PORT="8790"
URL="http://${HOST}:${PORT}"

find_python() {
  local candidate=""
  for candidate in python3.13 python3.12 python3; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      command -v "${candidate}"
      return 0
    fi
  done
  echo "Could not find python3 on PATH." >&2
  echo "Install Python 3.12+ from https://www.python.org/downloads/ or via Homebrew: brew install python" >&2
  exit 1
}

if [[ ! -x "${VENV_PYTHON}" ]]; then
  PY="$(find_python)"
  echo "Creating launcher venv at ${VENV_DIR}"
  "${PY}" -m venv "${VENV_DIR}"
fi

"${VENV_PYTHON}" -m pip install --upgrade pip >/dev/null
"${VENV_PYTHON}" -m pip install -r "${LAUNCHER_DIR}/requirements.txt"

echo "Starting AR Bridge launcher at ${URL}"
echo "Leave this window open. Press Ctrl+C to stop."
cd "${LAUNCHER_DIR}"

wait_for_server() {
  local attempt=0
  local max_attempts=50
  while [[ "${attempt}" -lt "${max_attempts}" ]]; do
    if curl -sf "${URL}/api/status" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "${UVICORN_PID}" 2>/dev/null; then
      echo "Launcher exited before becoming ready." >&2
      wait "${UVICORN_PID}" || true
      return 1
    fi
    sleep 0.2
    attempt=$((attempt + 1))
  done
  echo "Timed out waiting for launcher at ${URL}" >&2
  return 1
}

cleanup() {
  if [[ -n "${UVICORN_PID:-}" ]] && kill -0 "${UVICORN_PID}" 2>/dev/null; then
    kill "${UVICORN_PID}" 2>/dev/null || true
    wait "${UVICORN_PID}" 2>/dev/null || true
  fi
}
trap cleanup INT TERM

"${VENV_PYTHON}" -m uvicorn app:app --host "${HOST}" --port "${PORT}" &
UVICORN_PID=$!

if wait_for_server && command -v open >/dev/null 2>&1; then
  open "${URL}"
fi

wait "${UVICORN_PID}"
