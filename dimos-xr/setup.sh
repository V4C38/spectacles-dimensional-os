#!/usr/bin/env bash
# Set up DimOS + dimos-xr for local development.
#
# Usage:
#   ./setup.sh         # interactive first-run setup
#   ./setup.sh --yes   # non-interactive; fail fast if DimOS cannot be auto-detected
#
# Environment (optional):
#   DIMOS_PYTHON  Path to Python in an existing DimOS environment
#   CI=1          Same as --yes

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${ROOT}/scripts/_dimos_env.sh"

NON_INTERACTIVE=0
if [[ "${CI:-}" == "1" ]]; then
  NON_INTERACTIVE=1
fi

for arg in "$@"; do
  case "${arg}" in
    --yes|-y) NON_INTERACTIVE=1 ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: ${arg}" >&2
      echo "Try: $0 --help" >&2
      exit 1
      ;;
  esac
done

DEFAULT_DIMOS_DIR="$(cd "${ROOT}/../.." && pwd)/dimos"

ask_yes_no() {
  local prompt="$1"
  local default="${2:-}"
  local reply=""

  while true; do
    if [[ -n "${default}" ]]; then
      read -r -p "${prompt} [${default}] " reply
      reply="${reply:-${default}}"
    else
      read -r -p "${prompt} " reply
    fi
    case "${reply}" in
      y|Y|yes|YES) return 0 ;;
      n|N|no|NO) return 1 ;;
      *) echo "Please answer y or n." ;;
    esac
  done
}

prompt_with_default() {
  local prompt="$1"
  local default="$2"
  local reply=""
  read -r -p "${prompt} [${default}] " reply
  printf '%s\n' "${reply:-${default}}"
}

python_is_ge_312() {
  local py="$1"
  "${py}" - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info >= (3, 12) else 1)
PY
}

find_python_for_venv() {
  local candidate=""
  for candidate in python3.13 python3.12 python3; do
    if command -v "${candidate}" >/dev/null 2>&1 && python_is_ge_312 "$(command -v "${candidate}")"; then
      command -v "${candidate}"
      return 0
    fi
  done
  return 1
}

prompt_for_existing_dimos_python() {
  local candidate=""
  while true; do
    read -r -p "Enter the path to the Python executable in your DimOS environment: " candidate
    if [[ -z "${candidate}" ]]; then
      echo "A Python path is required."
      continue
    fi
    if [[ ! -x "${candidate}" ]]; then
      echo "Not executable: ${candidate}"
      continue
    fi
    if ! python_has_dimos "${candidate}"; then
      echo "That interpreter does not have the 'dimos' package installed."
      continue
    fi
    printf '%s\n' "${candidate}"
    return 0
  done
}

install_dimos_from_clone() {
  local dimos_dir="$1"
  local bootstrap_python="$2"
  local dimos_python="${dimos_dir}/.venv/bin/python3"

  if [[ -e "${dimos_dir}" ]]; then
    if [[ -d "${dimos_dir}" ]] && [[ -z "$(ls -A "${dimos_dir}")" ]]; then
      :
    else
      echo "Refusing to clone into non-empty path: ${dimos_dir}" >&2
      exit 1
    fi
  fi

  echo "Cloning DimOS into: ${dimos_dir}" >&2
  git clone "https://github.com/dimensionalOS/dimos" "${dimos_dir}" 1>&2
  "${bootstrap_python}" -m venv "${dimos_dir}/.venv"
  (
    cd "${dimos_dir}"
    "${dimos_python}" -m pip install -e ".[base,unitree]" 1>&2
  ) 
  printf '%s\n' "${dimos_python}"
}

resolve_dimos_python() {
  local found=""
  local bootstrap_python=""
  local dimos_dir=""

  if [[ "${NON_INTERACTIVE}" -eq 1 ]]; then
    if found="$(find_dimos_python "${ROOT}")"; then
      printf '%s\n' "${found}"
      return 0
    fi
    print_dimos_python_help "${ROOT}"
    exit 1
  fi

  if ask_yes_no "Is DimOS already installed on this Mac?" "n"; then
    if found="$(find_dimos_python "${ROOT}")"; then
      echo "Detected DimOS Python: ${found}" >&2
      if ask_yes_no "Use this interpreter?" "y"; then
        printf '%s\n' "${found}"
        return 0
      fi
    else
      echo "Auto-detection did not find DimOS." >&2
    fi
    prompt_for_existing_dimos_python
    return 0
  fi

  if ! bootstrap_python="$(find_python_for_venv)"; then
    echo "Could not find Python 3.12+ on PATH. Install Python 3.12+ and re-run ./setup.sh." >&2
    exit 1
  fi

  dimos_dir="$(prompt_with_default "Where should DimOS be cloned?" "${DEFAULT_DIMOS_DIR}")"
  install_dimos_from_clone "${dimos_dir}" "${bootstrap_python}"
}

echo "Resolving DimOS environment..."
DIMOS_ENV_PYTHON="$(resolve_dimos_python)"

echo "Using DimOS Python: ${DIMOS_ENV_PYTHON}"
echo "Installing dimos-xr into that environment..."
(
  cd "${ROOT}"
  "${DIMOS_ENV_PYTHON}" -m pip install -e ".[dev]"
)

echo "Running unit tests..."
(
  cd "${ROOT}"
  "${DIMOS_ENV_PYTHON}" -m pytest
)

cat <<EOF

Setup complete.

Next steps:
  cd "${ROOT}"
  ./start.sh

If DimOS lives somewhere unusual, you can always override auto-detection with:
  DIMOS_PYTHON=/path/to/dimos/.venv/bin/python3 ./start.sh
EOF
