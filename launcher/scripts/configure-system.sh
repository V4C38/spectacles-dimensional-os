#!/usr/bin/env bash
# Apply the macOS system settings DimOS needs for LCM before the AR bridge boots.
#
# This mirrors DimOS's own macOS LCM configurators
# (dimos/protocol/service/system_configurator/lcm.py) so the bridge can start
# unattended: the launcher applies these once (with one admin prompt) and DimOS
# then finds them already in place and does not prompt again.
#
# The privileged commands live here (single source of truth). Elevation is the
# CALLER's job: run this whole script under sudo / osascript. It contains no
# internal sudo, so it must be executed as root to apply changes.
#
# Usage:
#   configure-system.sh --check [--state-dir <dir>]   # exit 0 = ok, 10 = needs config (sudo)
#   configure-system.sh --apply [--state-dir <dir>]   # apply (run as root)
#
# macOS resets these on reboot, so --check may report "needs config" again after
# a restart; re-applying is idempotent and safe.

set -euo pipefail

TARGET_BUF=67108864          # 64 MiB, matches DimOS IDEAL_RMEM_SIZE
MIN_BUF=1048576              # 1 MiB floor when halving down
TARGET_FILES=65536          # matches DimOS TARGET_FILE_COUNT_LIMIT
MULTICAST_NET="224.0.0.0/4"
LOOPBACK="lo0"

MODE=""
STATE_DIR="${DIMOS_STATE_DIR:-${HOME}/.local/state/dimos}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE="check"; shift ;;
    --apply) MODE="apply"; shift ;;
    --state-dir)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "--state-dir requires a path" >&2
        exit 2
      fi
      STATE_DIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2 ;;
  esac
done

if [[ -z "${MODE}" ]]; then
  echo "Specify --check or --apply" >&2
  exit 2
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  # Non-macOS: nothing for this helper to do (bridge is macOS-oriented).
  [[ "${MODE}" == "check" ]] && exit 0
  exit 0
fi

SYSCTL_KEYS=("kern.ipc.maxsockbuf" "net.inet.udp.recvspace" "net.inet.udp.maxdgram")

route_ok() {
  local line
  while IFS= read -r line; do
    if [[ "${line}" == *"224.0.0.0/4"* || "${line}" == *"224.0.0/4"* ]]; then
      [[ "${line}" == *"${LOOPBACK}"* ]] && return 0
    fi
  done < <(netstat -nr 2>/dev/null)
  return 1
}

read_saved() {
  # Extract an integer value for a key from our JSON state file, if present.
  local key="$1" file="${STATE_DIR}/sysctl.json" escaped
  [[ -f "${file}" ]] || return 1
  escaped="${key//./\\.}"
  grep -oE "\"${escaped}\"[[:space:]]*:[[:space:]]*[0-9]+" "${file}" 2>/dev/null \
    | grep -oE '[0-9]+' | tail -1
}

effective_target() {
  local key="$1" saved
  saved="$(read_saved "${key}" || true)"
  if [[ -n "${saved}" ]]; then
    printf '%s\n' "${saved}"
  else
    printf '%s\n' "${TARGET_BUF}"
  fi
}

current_sysctl() {
  sysctl -n "$1" 2>/dev/null || echo 0
}

buffers_ok() {
  local key target current
  for key in "${SYSCTL_KEYS[@]}"; do
    target="$(effective_target "${key}")"
    current="$(current_sysctl "${key}")"
    (( current < target )) && return 1
  done
  return 0
}

maxfiles_hard() {
  # Second column of `launchctl limit maxfiles` is the hard limit.
  local hard
  hard="$(launchctl limit maxfiles 2>/dev/null | awk '/maxfiles/{print $3}')"
  [[ "${hard}" == "unlimited" ]] && { echo 1000000000; return 0; }
  [[ "${hard}" =~ ^[0-9]+$ ]] && { echo "${hard}"; return 0; }
  echo 0
}

maxfiles_ok() {
  # Only a reason to prompt for sudo when the HARD cap is too low; raising the
  # soft limit up to an adequate hard cap needs no privileges (DimOS does that).
  local hard
  hard="$(maxfiles_hard)"
  (( hard >= TARGET_FILES ))
}

needs_config() {
  ! route_ok || ! buffers_ok || ! maxfiles_ok
}

print_status() {
  route_ok && echo "Multicast route (${MULTICAST_NET} -> ${LOOPBACK}): ok" >&2 \
            || echo "Multicast route (${MULTICAST_NET} -> ${LOOPBACK}): missing" >&2
  buffers_ok && echo "Socket buffers: ok" >&2 || echo "Socket buffers: below target" >&2
  maxfiles_ok && echo "Open-file hard limit: ok" >&2 || echo "Open-file hard limit: too low" >&2
}

if [[ "${MODE}" == "check" ]]; then
  print_status
  if needs_config; then
    echo "SYSCONFIG_NEEDED=1" >&2
    exit 10
  fi
  echo "SYSCONFIG_NEEDED=0" >&2
  exit 0
fi

# --- apply (must be root) ---------------------------------------------------

if [[ "$(id -u)" != "0" ]]; then
  echo "configure-system.sh --apply must run as root (elevate via sudo/osascript)." >&2
  exit 2
fi

echo "Applying DimOS system prerequisites…"

# 1) Multicast route (critical for LCM). Delete any stale route first so the
#    add cannot fail with "route already in use", then add on loopback.
if ! route_ok; then
  route delete -net "${MULTICAST_NET}" >/dev/null 2>&1 || true
  if route add -net "${MULTICAST_NET}" -interface "${LOOPBACK}" >/dev/null 2>&1; then
    echo "Multicast route added (${MULTICAST_NET} -> ${LOOPBACK})."
  else
    echo "ERROR: failed to add multicast route (${MULTICAST_NET} -> ${LOOPBACK})." >&2
    exit 1
  fi
else
  echo "Multicast route already present."
fi

# 2) Socket buffers (optional): raise toward target, halving on rejection.
ACHIEVED_MAXSOCKBUF=""
ACHIEVED_RECVSPACE=""
ACHIEVED_MAXDGRAM=""

apply_buffer() {
  local key="$1" target current val
  target="$(effective_target "${key}")"
  current="$(current_sysctl "${key}")"
  val="${target}"
  while (( val > current )); do
    if sysctl -w "${key}=${val}" >/dev/null 2>&1; then
      current="${val}"
      break
    fi
    val=$(( val / 2 ))
    (( val < MIN_BUF )) && break
  done
  printf '%s\n' "${current}"
}

ACHIEVED_MAXSOCKBUF="$(apply_buffer "kern.ipc.maxsockbuf")"
ACHIEVED_RECVSPACE="$(apply_buffer "net.inet.udp.recvspace")"
ACHIEVED_MAXDGRAM="$(apply_buffer "net.inet.udp.maxdgram")"
echo "Socket buffers set (maxsockbuf=${ACHIEVED_MAXSOCKBUF}, recvspace=${ACHIEVED_RECVSPACE}, maxdgram=${ACHIEVED_MAXDGRAM})."

# Record achieved values in the same state file DimOS reads, so it does not try
# to raise them again (and re-prompt) on the next launch.
mkdir -p "${STATE_DIR}"
cat > "${STATE_DIR}/sysctl.json" <<JSON
{"kern.ipc.maxsockbuf": ${ACHIEVED_MAXSOCKBUF}, "net.inet.udp.recvspace": ${ACHIEVED_RECVSPACE}, "net.inet.udp.maxdgram": ${ACHIEVED_MAXDGRAM}}
JSON
if [[ -n "${SUDO_USER:-}" ]]; then
  chown -R "${SUDO_USER}" "${STATE_DIR}" 2>/dev/null || true
fi

# 3) Open-file hard limit (optional): raise the global cap so DimOS can lift its
#    soft limit without sudo.
if ! maxfiles_ok; then
  if launchctl limit maxfiles "${TARGET_FILES}" "${TARGET_FILES}" >/dev/null 2>&1; then
    echo "Open-file limit raised to ${TARGET_FILES}."
  else
    echo "WARNING: could not raise open-file limit (non-fatal)." >&2
  fi
fi

echo "System configuration complete."
