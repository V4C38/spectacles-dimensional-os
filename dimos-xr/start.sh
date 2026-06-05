#!/usr/bin/env bash
# Start the dimos-xr bridge from this monorepo package.
#
# Usage:
#   ./start.sh              # choose the target robot stack interactively
#
# Environment (optional):
#   DIMOS_PYTHON   Path to Python in your DimOS .venv (overrides auto-detect)
#   LISTEN_HOST    WebSocket bind address (default 0.0.0.0)
#   MARKER_PORT    Calibration board HTTP port (default 8766)
#   DIMOS_CONFIGURE_SYSTEM=1  Enable interactive sysctl/ulimit prompts (off by default)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLUEPRINT="${ROOT}/blueprints/dimos_xr.py"
source "${ROOT}/scripts/_dimos_env.sh"

if [[ "$#" -ne 0 ]]; then
  echo "start.sh does not take command-line arguments." >&2
  echo "Run it without arguments and choose the robot from the menu." >&2
  exit 1
fi

if ! PYTHON="$(find_dimos_python "${ROOT}")"; then
  print_dimos_python_help "${ROOT}"
  exit 1
fi
if [[ ! -f "${BLUEPRINT}" ]]; then
  echo "Blueprint not found: ${BLUEPRINT}" >&2
  exit 1
fi

if [[ -z "${DIMOS_CONFIGURE_SYSTEM:-}" && -z "${CI:-}" ]]; then
  export CI=1
fi
export LISTEN_HOST="${LISTEN_HOST:-0.0.0.0}"

# Ensure venv bin is on PATH so tools like `rerun` are discoverable by child processes.
export PATH="$(dirname "${PYTHON}"):${PATH}"

# Suppress harmless macOS dylib duplicate-class warnings from cv2/av fork clash.
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES

# Detect LAN IP for the user.
LAN_IP="$(detect_lan_ip)"

echo "Choose the robot stack to run:"
echo "  1. Unitree Go2"
echo "  2. Unitree Go2 Basic (best-effort / non-nav)"
echo "  3. Unitree G1 (nav onboard, recommended)"
echo "  4. Unitree G1 (reduced / non-nav)"
read -r -p "Selection [1-4]: " CHOICE
CHOICE="${CHOICE:-1}"

case "${CHOICE}" in
  1)
    export DIMOS_XR_STACK="unitree-go2"
    STACK_LABEL="Unitree Go2"
    EQUIVALENT="dimos run unitree-go2 dimos-xr"
    ;;
  2)
    export DIMOS_XR_STACK="unitree-go2-basic"
    STACK_LABEL="Unitree Go2 Basic (best-effort)"
    EQUIVALENT="dimos run unitree-go2-basic dimos-xr"
    ;;
  3)
    export DIMOS_XR_STACK="unitree-g1-nav-onboard"
    STACK_LABEL="Unitree G1 (nav onboard)"
    EQUIVALENT="dimos run unitree-g1-nav-onboard dimos-xr"
    ;;
  4)
    export DIMOS_XR_STACK="unitree-g1"
    STACK_LABEL="Unitree G1 (reduced)"
    EQUIVALENT="dimos run unitree-g1 dimos-xr"
    ;;
  *)
    echo "Invalid selection: ${CHOICE}" >&2
    exit 1
    ;;
esac

echo "Using Python: ${PYTHON}"
echo "Blueprint:    ${BLUEPRINT}"
echo "Stack:        ${STACK_LABEL}"
echo "Equivalent:   ${EQUIVALENT}"
echo "WebSocket:    ws://${LISTEN_HOST}:8787"
echo "Spectacles:   enter ${LAN_IP} in the lens"
MARKER_PORT="${MARKER_PORT:-8766}"
echo "Marker page:  http://${LAN_IP}:${MARKER_PORT}/  (QR code printed when server starts)"
echo ""
echo "Ctrl+C to stop."
echo ""

exec "${PYTHON}" "${BLUEPRINT}" < /dev/null 2> >(grep -v '^objc\[' >&2)
