#!/usr/bin/env bash
# Shared shell helpers for launcher/scripts/setup.sh and launcher/scripts/start.sh.
# Source this file; do not execute directly.
python_has_dimos() {
  local py="${1:-}"
  [[ -n "${py}" && -x "${py}" ]] || return 1
  "${py}" -c "import dimos" >/dev/null 2>&1
}

# Resolve a path to an absolute form without ".." segments (for UI / logs).
resolve_abs_path() {
  local p="${1:-}"
  local dir=""
  local base=""
  [[ -n "${p}" ]] || return 1
  if [[ -e "${p}" || -L "${p}" ]]; then
    dir="$(cd "$(dirname "${p}")" && pwd -P)"
    base="$(basename "${p}")"
    printf '%s\n' "${dir}/${base}"
    return 0
  fi
  # Non-existent path: still normalize parent if possible.
  if dir="$(cd "$(dirname "${p}")" 2>/dev/null && pwd -P)"; then
    printf '%s\n' "${dir}/$(basename "${p}")"
    return 0
  fi
  printf '%s\n' "${p}"
}

# True when DimOS is an editable/source install that ships native module trees
# (FastLio2 cpp/ + RayTracingVoxelMap rust/). PyPI wheels omit these dirs, so
# G1's nav stack cannot build native binaries from a wheel-only install.
dimos_has_native_source() {
  local py="${1:-}"
  [[ -n "${py}" && -x "${py}" ]] || return 1
  "${py}" - <<'PY' >/dev/null 2>&1
import inspect
import pathlib

try:
    from dimos.hardware.sensors.lidar.fastlio2 import module as f
    from dimos.mapping.ray_tracing import module as r
except Exception:
    raise SystemExit(1)

fd = pathlib.Path(inspect.getfile(f)).resolve().parent
rd = pathlib.Path(inspect.getfile(r)).resolve().parent
ok = (fd / "cpp").is_dir() and (rd / "rust").is_dir()
raise SystemExit(0 if ok else 1)
PY
}

find_dimos_python() {
  local root="${1:-${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}}"
  local candidates=()
  local system_python=""
  local py

  if [[ -n "${DIMOS_PYTHON:-}" ]]; then
    if [[ ! -x "${DIMOS_PYTHON}" ]]; then
      echo "DIMOS_PYTHON is not executable: ${DIMOS_PYTHON}" >&2
      return 2
    fi
    if python_has_dimos "${DIMOS_PYTHON}"; then
      resolve_abs_path "${DIMOS_PYTHON}"
      return 0
    fi
    echo "DIMOS_PYTHON does not have the 'dimos' package installed: ${DIMOS_PYTHON}" >&2
    return 2
  fi

  candidates=(
    "${root}/../dimos/.venv/bin/python3"
    "${root}/../../dimos/.venv/bin/python3"
    "${root}/dimos-ar/.venv/bin/python3"
  )

  for py in "${candidates[@]}"; do
    if python_has_dimos "${py}"; then
      resolve_abs_path "${py}"
      return 0
    fi
  done

  system_python="$(command -v python3 2>/dev/null || true)"
  if python_has_dimos "${system_python}"; then
    resolve_abs_path "${system_python}"
    return 0
  fi

  return 1
}

print_dimos_python_help() {
  local root="${1:-${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}}"
  local system_python
  system_python="$(command -v python3 2>/dev/null || echo "python3")"

  cat >&2 <<EOF
Could not find a Python interpreter with the 'dimos' package installed.

Tried:
  - ${root}/../dimos/.venv/bin/python3
  - ${root}/../../dimos/.venv/bin/python3
  - ${root}/dimos-ar/.venv/bin/python3
  - ${system_python}

Fix one of these, then retry:
  - Set DIMOS_PYTHON=/path/to/dimos/.venv/bin/python3
  - Run ./launcher/scripts/setup.sh and point it at your DimOS install
  - Install dimos-ar into your DimOS venv manually:
      cd "${root}/dimos-ar" && /path/to/dimos/.venv/bin/python3 -m pip install -e ".[dev]"
EOF
}

detect_lan_ip() {
  local iface=""
  local ip=""
  local candidate=""

  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  if [[ -n "${iface}" ]]; then
    ip="$(ipconfig getifaddr "${iface}" 2>/dev/null || true)"
    if [[ -n "${ip}" ]]; then
      printf '%s\n' "${ip}"
      return 0
    fi
  fi

  for candidate in en0 en1 en2 en3 en4 en5 en6 en7 en8 en9; do
    ip="$(ipconfig getifaddr "${candidate}" 2>/dev/null || true)"
    if [[ -n "${ip}" ]]; then
      printf '%s\n' "${ip}"
      return 0
    fi
  done

  printf '%s\n' "unknown"
}
