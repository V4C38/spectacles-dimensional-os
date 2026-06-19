#!/usr/bin/env bash

python_has_dimos() {
  local py="${1:-}"
  [[ -n "${py}" && -x "${py}" ]] || return 1
  "${py}" -c "import dimos" >/dev/null 2>&1
}

find_dimos_python() {
  local root="${1:-${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
  local candidates=()
  local system_python=""
  local py

  if [[ -n "${DIMOS_PYTHON:-}" ]]; then
    if [[ ! -x "${DIMOS_PYTHON}" ]]; then
      echo "DIMOS_PYTHON is not executable: ${DIMOS_PYTHON}" >&2
      return 2
    fi
    if python_has_dimos "${DIMOS_PYTHON}"; then
      printf '%s\n' "${DIMOS_PYTHON}"
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
      printf '%s\n' "${py}"
      return 0
    fi
  done

  system_python="$(command -v python3 2>/dev/null || true)"
  if python_has_dimos "${system_python}"; then
    printf '%s\n' "${system_python}"
    return 0
  fi

  return 1
}

print_dimos_python_help() {
  local root="${1:-${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
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
  - Run ./setup.sh and point it at your DimOS install
  - Install dimos-ar into your DimOS venv manually:
      cd "${root}" && /path/to/dimos/.venv/bin/python3 -m pip install -e ".[dev]"
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
