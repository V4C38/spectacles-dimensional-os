#!/usr/bin/env bash
# Start the dimos-ar bridge from this monorepo package.
#
# Usage:
#   ./launcher/scripts/start.sh
#   ./launcher/scripts/start.sh --stack go2|g1
#   ./launcher/scripts/start.sh --stack go2 --robot-ip <ip|simulated>
#
# The robot is auto-discovered on the LAN (Unitree multicast) unless --robot-ip
# (or ROBOT_IP) pins an address. When several are found interactively you get a
# selector; non-interactive mode auto-picks a single robot or falls back to simulated.
#
# Environment (optional):
#   DIMOS_PYTHON   Path to Python in your DimOS .venv (overrides auto-detect)
#   ROBOT_IP       Pin a specific robot IP and skip discovery (or "simulated" replay)
#   LISTEN_HOST    WebSocket bind address (default 0.0.0.0)
#   DIMOS_LOG_LEVEL  Log verbosity (default INFO; set DEBUG for verbose runs)
#   DIMOS_AR_FORCE_COLOR=1  Force ANSI colors when stdout is not a TTY
#   DIMOS_CONFIGURE_SYSTEM=1  Enable interactive sysctl/ulimit prompts (off by default)
#   DIMOS_AR_SKIP_OPENAI_CHECK=1  Skip the OpenAI API reachability probe at startup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DIMOS_AR_ROOT="${ROOT}/dimos-ar"
source "${SCRIPT_DIR}/dimos_lib.sh"

# DimOS offline replay accepts fake|mock|replay; launcher UI/docs use "simulated".
DIMOS_SIMULATED_IP="fake"

_color_enabled() {
  local fd="$1"
  if [[ -t "${fd}" ]]; then
    return 0
  fi
  case "${DIMOS_AR_FORCE_COLOR:-}" in
    ""|0|false|FALSE|False) return 1 ;;
    *) return 0 ;;
  esac
}

print_green_stdout() {
  if _color_enabled 1; then
    printf '\033[32m%s\033[0m\n' "$1"
  else
    printf '%s\n' "$1"
  fi
}

print_green_stderr() {
  if _color_enabled 2; then
    printf '\033[32m%s\033[0m\n' "$1" >&2
  else
    printf '%s\n' "$1" >&2
  fi
}

print_red_stderr() {
  if _color_enabled 2; then
    printf '\033[31m%s\033[0m\n' "$1" >&2
  else
    printf '%s\n' "$1" >&2
  fi
}

STACK_FLAG=""
ROBOT_IP_FLAG=""
NON_INTERACTIVE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "--stack requires go2 or g1" >&2
        exit 1
      fi
      STACK_FLAG="$2"
      NON_INTERACTIVE=1
      shift 2
      ;;
    --robot-ip)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "--robot-ip requires an IP address or 'simulated'" >&2
        exit 1
      fi
      ROBOT_IP_FLAG="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Try: $0 --help" >&2
      exit 1
      ;;
  esac
done

if [[ -n "${ROBOT_IP_FLAG}" ]]; then
  ROBOT_IP="${ROBOT_IP_FLAG}"
fi

if ! PYTHON="$(find_dimos_python "${ROOT}")"; then
  print_dimos_python_help "${ROOT}"
  exit 1
fi

# DimOS needs a few macOS network settings for LCM (multicast route, socket
# buffers) that require admin rights. Apply them here with a normal sudo prompt
# before booting, so the DimOS process itself never has to prompt (it runs with
# stdin redirected and cannot). The launcher sets DIMOS_AR_SKIP_SYSCONFIG=1
# because it applies the same step via the native macOS admin prompt beforehand.
ensure_system_config() {
  [[ "$(uname -s)" == "Darwin" ]] || return 0
  [[ -n "${DIMOS_AR_SKIP_SYSCONFIG:-}" ]] && return 0

  local helper="${SCRIPT_DIR}/configure-system.sh"
  local state_dir="${HOME}/.local/state/dimos"
  [[ -x "${helper}" ]] || return 0

  if "${helper}" --check --state-dir "${state_dir}" 2>/dev/null; then
    return 0
  fi

  echo "Configuring macOS network settings for DimOS (requires your admin password)…" >&2
  if sudo "${helper}" --apply --state-dir "${state_dir}"; then
    export DIMOS_AR_SKIP_SYSCONFIG=1
  else
    print_red_stderr "System configuration failed — the bridge may not start."
    print_red_stderr "You can retry, or apply manually: sudo ${helper} --apply"
    exit 1
  fi
}

ensure_system_config

if [[ -z "${DIMOS_CONFIGURE_SYSTEM:-}" && -z "${CI:-}" ]]; then
  export CI=1
fi
export LISTEN_HOST="${LISTEN_HOST:-0.0.0.0}"
export DIMOS_LOG_LEVEL="${DIMOS_LOG_LEVEL:-INFO}"

# Ensure venv bin is on PATH so tools like `rerun` are discoverable by child processes.
export PATH="$(dirname "${PYTHON}"):${PATH}"

# Suppress harmless macOS dylib duplicate-class warnings from cv2/av fork clash.
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES

# Detect LAN IP for the user (also passed to the bridge "Bridge ready" banner).
LAN_IP="$(detect_lan_ip)"
export DIMOS_AR_LAN_IP="${LAN_IP}"

STACK_IDS=(
  "ar_go2"
  "ar_g1"
)
MENU_LABELS=(
  "Unitree Go2"
  "Unitree G1"
)

# Interactive arrow-key menu: up/down to move, Enter to select.
# Usage: arrow_menu "Prompt line" "option 1" "option 2" ...
# Sets SELECTED_INDEX (0-based). Falls back to a numbered prompt when
# stdin/stdout is not a terminal (e.g. piped input).
arrow_menu() {
  local prompt="$1"
  shift
  local options=("$@")
  local n=${#options[@]}
  local cur=0
  local i key choice

  if [[ ! -t 0 || ! -t 1 ]]; then
    echo "${prompt}"
    for ((i = 0; i < n; i++)); do
      echo "  $((i + 1)). ${options[$i]}"
    done
    read -r -p "Selection [1-${n}]: " choice
    choice="${choice:-1}"
    if [[ ! "${choice}" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > n )); then
      echo "Invalid selection: ${choice}" >&2
      exit 1
    fi
    SELECTED_INDEX=$((choice - 1))
    return 0
  fi

  echo "${prompt}"
  printf '\033[?25l'  # hide cursor
  trap 'printf "\033[?25h"' RETURN

  while true; do
    for ((i = 0; i < n; i++)); do
      if (( i == cur )); then
        printf '  \033[36m▶ %s\033[0m\033[K\n' "${options[$i]}"
      else
        printf '    %s\033[K\n' "${options[$i]}"
      fi
    done

    IFS= read -rsn1 key
    if [[ "${key}" == $'\033' ]]; then
      read -rsn2 key
      case "${key}" in
        '[A') cur=$(( (cur - 1 + n) % n )) ;;
        '[B') cur=$(( (cur + 1) % n )) ;;
      esac
    elif [[ -z "${key}" ]]; then
      break  # Enter
    fi

    printf '\033[%dA' "${n}"  # move cursor back up to redraw
  done

  printf '\033[?25h'  # restore cursor
  trap - RETURN
  SELECTED_INDEX=${cur}
}

# Resolve the robot's IP via the official Unitree multicast discovery (the same
# mechanism the Unitree app/SDK use). Auto-selects when exactly one robot is
# present, shows a selector when several are (interactive only), and falls back
# to offline replay when none are found. Sets ROBOT_IP.
resolve_robot_ip() {
  local discovered=()
  local labels=()
  local line sn ip count

  echo "Discovering robots on the network..." >&2
  while IFS= read -r line; do
    [[ -n "${line}" ]] && discovered+=("${line}")
  done < <("${PYTHON}" -c "
from dimos.robot.unitree.go2.cli.landiscovery import discover

try:
    devices = discover(timeout=2.0)
except OSError:
    devices = []

for device in devices:
    print(f'{device.serial}\t{device.ip}')
" 2>/dev/null)

  count=${#discovered[@]}

  if (( count == 1 )); then
    sn="${discovered[0]%%$'\t'*}"
    ip="${discovered[0]#*$'\t'}"
    ROBOT_IP="${ip}"
    print_green_stderr "Found robot ${sn} at ${ip}"
    return 0
  fi

  if (( count > 1 )); then
    if [[ "${NON_INTERACTIVE}" -eq 1 ]]; then
      sn="${discovered[0]%%$'\t'*}"
      ip="${discovered[0]#*$'\t'}"
      ROBOT_IP="${ip}"
      print_green_stderr "Found ${count} robots — using first: ${sn} at ${ip}"
      return 0
    fi
    for line in "${discovered[@]}"; do
      sn="${line%%$'\t'*}"
      ip="${line#*$'\t'}"
      labels+=("${sn}  (${ip})")
    done
    arrow_menu "Multiple robots found — choose one (↑/↓ then Enter):" "${labels[@]}"
    ROBOT_IP="${discovered[$SELECTED_INDEX]#*$'\t'}"
    return 0
  fi

  print_red_stderr "No robots found on the network — using offline replay (ROBOT_IP=simulated)."
  echo "Set ROBOT_IP=<ip> and re-run to target a specific robot." >&2
  echo "Tip: --robot-ip simulated (or ROBOT_IP=simulated) skips discovery and starts faster." >&2
  ROBOT_IP="simulated"
}

if [[ -n "${STACK_FLAG}" ]]; then
  case "${STACK_FLAG}" in
    go2|ar_go2)
      SELECTED_INDEX=0
      ;;
    g1|ar_g1)
      SELECTED_INDEX=1
      ;;
    *)
      echo "Unknown stack: ${STACK_FLAG} (expected go2 or g1)" >&2
      exit 1
      ;;
  esac
else
  arrow_menu "Choose the robot stack to run (↑/↓ then Enter):" "${MENU_LABELS[@]}"
fi

SELECTED_BLUEPRINT="${STACK_IDS[$SELECTED_INDEX]}"
STACK_LABEL="${MENU_LABELS[$SELECTED_INDEX]}"
EQUIVALENT="dimos run ${SELECTED_BLUEPRINT//_/-}"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "Warning: OPENAI_API_KEY is unset — agent mode will not work until it is set." >&2
elif [[ -z "${DIMOS_AR_SKIP_OPENAI_CHECK:-}" ]]; then
  if openai_api_reachable; then
    print_green_stderr "OpenAI API: reachable"
  else
    print_red_stderr "OpenAI API: unreachable — voice commands will hang at \"Working: thinking...\""
    echo "Check network/DNS (router parental controls, hotspot, VPN). Bridge will still start." >&2
  fi
fi

# DimOS GlobalConfig reads ROBOT_IP (or a .env file) to open the robot
# connection; without it the connection module aborts with "IP address must be
# provided". Auto-discover unless the caller pinned ROBOT_IP via --robot-ip or env.
if [[ -z "${ROBOT_IP:-}" ]]; then
  resolve_robot_ip
fi

# Map launcher "simulated" (and legacy "fake") to DimOS offline replay token.
DISPLAY_ROBOT_IP="${ROBOT_IP}"
case "${ROBOT_IP}" in
  simulated|fake)
    DISPLAY_ROBOT_IP="simulated"
    ROBOT_IP="${DIMOS_SIMULATED_IP}"
    ;;
esac
export ROBOT_IP

echo "Using Python: ${PYTHON}"
echo "Blueprint:    ${SELECTED_BLUEPRINT}"
echo "Stack:        ${STACK_LABEL}"
echo "Equivalent:   ${EQUIVALENT}"
echo "Robot IP:     ${DISPLAY_ROBOT_IP}"
echo "WebSocket:    ws://${LISTEN_HOST}:8787 (not listening yet — booting DimOS stack…)"
echo "Log level:    ${DIMOS_LOG_LEVEL} (verbose: DIMOS_LOG_LEVEL=DEBUG ./launcher/scripts/start.sh)"
echo "Logs:         stdout + ~/.local/state/dimos/logs/.../main.jsonl (dimos log -f)"
print_green_stdout "Spectacles:   enter ${LAN_IP} in the lens"
echo ""
echo "Ctrl+C to stop."
echo ""

# Lens may retry WebSocket connections before the AR server finishes booting.
# A one-off Go2 :8081 /offer refusal usually means the robot-side runtime was
# still coming up, not that the Lens-side ws://<host>:8787 bridge is misconfigured.

exec "${PYTHON}" -c "
import os
import sys
sys.path.insert(0, '${DIMOS_AR_ROOT}')
if os.environ.get('DIMOS_AR_FORCE_COLOR', '') not in ('', '0', 'false'):
    import dimos.utils.logging_config as _lc
    _lc._CONSOLE_USE_COLORS = True
from dimos.ar.utils.console import install_ar_console_styles
install_ar_console_styles()
from dimos.core.coordination.module_coordinator import ModuleCoordinator
from dimos.ar.blueprints import ${SELECTED_BLUEPRINT}
ModuleCoordinator.build(${SELECTED_BLUEPRINT}).loop()
" < /dev/null 2> >(grep -v '^objc\[' >&2)
