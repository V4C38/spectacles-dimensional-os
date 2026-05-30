#!/usr/bin/env bash
# Start the dimos-ar Go2 blueprint (ARBridge WebSocket on port 8765).
#
# Usage:
#   ./start.sh              # Discover Go2 on LAN, or fall back to replay; WS on 0.0.0.0:8765
#   ./start.sh --replay     # Skip discovery; recorded lidar/odom only
#   ./start.sh --local      # WebSocket localhost-only (127.0.0.1) for same-machine clients
#
# Environment (optional):
#   DIMOS_PYTHON   Path to Python in your DimOS venv (overrides auto-detect)
#   ROBOT_SERIAL   Pin a specific Go2 serial (skips picker when several robots)
#   FORCE_REPLAY=1 Same as --replay
#   LISTEN_HOST    WebSocket bind address (default 0.0.0.0; use --local for 127.0.0.1)
#   MARKER_PORT    Calibration board HTTP port (default 8766)
#   DIMOS_CONFIGURE_SYSTEM=1  Enable interactive sysctl/ulimit prompts (off by default)
#
# Prerequisites:
#   pip install -e /path/to/dimos-ar   (inside the DimOS venv)
#   pip install "dimos[base,unitree]"  (or dimos-ar[unitree])

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLUEPRINT="${ROOT}/blueprints/go2_ar_nav.py"

python_has_dimos() {
  local py="$1"
  "${py}" -c "import dimos" >/dev/null 2>&1
}

find_python() {
  if [[ -n "${DIMOS_PYTHON:-}" && -x "${DIMOS_PYTHON}" ]]; then
    if python_has_dimos "${DIMOS_PYTHON}"; then
    echo "${DIMOS_PYTHON}"
    return
    fi
    echo "DIMOS_PYTHON does not have the 'dimos' package installed: ${DIMOS_PYTHON}" >&2
    exit 1
  fi
  local candidates=(
    "${ROOT}/../../dimos/.venv/bin/python3"
    "${ROOT}/../dimos/.venv/bin/python3"
    "${ROOT}/.venv/bin/python3"
  )
  for py in "${candidates[@]}"; do
    if [[ -x "${py}" ]] && python_has_dimos "${py}"; then
      echo "${py}"
      return
    fi
  done
  local system_python
  system_python="$(command -v python3)"
  if python_has_dimos "${system_python}"; then
    echo "${system_python}"
    return
  fi
  cat >&2 <<EOF
Could not find a Python interpreter with the 'dimos' package installed.

Tried:
  - ${ROOT}/../../dimos/.venv/bin/python3
  - ${ROOT}/../dimos/.venv/bin/python3
  - ${ROOT}/.venv/bin/python3
  - ${system_python}

Fix one of these, then retry:
  - Set DIMOS_PYTHON=/path/to/dimos/.venv/bin/python3
  - Install dimos-ar into your DimOS venv:
      /path/to/dimos/.venv/bin/python3 -m pip install -e "${ROOT}"
EOF
  exit 1
}

REPLAY=0
LOCAL=0
for arg in "$@"; do
  case "${arg}" in
    --replay) REPLAY=1 ;;
    --local) LOCAL=1 ;;
    --lan) ;; # no-op; all interfaces is the default
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: ${arg}" >&2
      echo "Try: $0 --help" >&2
      exit 1
      ;;
  esac
done

PYTHON="$(find_python)"
if [[ ! -f "${BLUEPRINT}" ]]; then
  echo "Blueprint not found: ${BLUEPRINT}" >&2
  exit 1
fi

export FORCE_REPLAY="${FORCE_REPLAY:-${REPLAY}}"
# DimOS skips interactive sudo sysctl prompts when CI is set (optional LCM tuning only).
if [[ -z "${DIMOS_CONFIGURE_SYSTEM:-}" && -z "${CI:-}" ]]; then
  export CI=1
fi
if [[ "${LOCAL}" -eq 1 ]]; then
  export LISTEN_HOST="${LISTEN_HOST:-127.0.0.1}"
else
  export LISTEN_HOST="${LISTEN_HOST:-0.0.0.0}"
fi

# Ensure venv bin is on PATH so tools like `rerun` are discoverable by child processes.
export PATH="$(dirname "${PYTHON}"):${PATH}"

# Suppress harmless macOS dylib duplicate-class warnings from cv2/av fork clash.
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES

# Detect LAN IP for the user.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || echo "unknown")"

echo "Using Python: ${PYTHON}"
echo "Blueprint:    ${BLUEPRINT}"
if [[ "${FORCE_REPLAY}" == "1" ]]; then
  echo "Mode:         replay (no robot)"
else
  echo "Mode:         discover Go2 on LAN, or replay if none found"
fi
echo "WebSocket:    ws://${LISTEN_HOST}:8765"
echo "Spectacles:   enter ${LAN_IP} in the lens"
MARKER_PORT="${MARKER_PORT:-8766}"
echo "Marker page:  http://${LAN_IP}:${MARKER_PORT}/  (QR code printed when server starts)"
echo ""
echo "First replay run may download ~80 MB of recorded data."
echo "Ctrl+C to stop."
echo ""

exec "${PYTHON}" "${BLUEPRINT}" 2> >(grep -v '^objc\[' >&2)
