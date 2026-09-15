#!/usr/bin/env bash
# Set up DimOS + dimos-ar for local development.
#
# Usage:
#   ./launcher/scripts/setup.sh              # interactive first-run setup
#   ./launcher/scripts/setup.sh --yes        # non-interactive; fail fast if DimOS cannot be auto-detected
#   ./launcher/scripts/setup.sh --check      # non-destructive readiness probe (for the web launcher)
#   ./launcher/scripts/setup.sh --yes --dimos-python <path>   # use existing DimOS interpreter
#   ./launcher/scripts/setup.sh --yes --clone-dir <path> [--dimos-ref <branch|tag|sha>]
#
# Environment (optional):
#   DIMOS_PYTHON  Path to Python in an existing DimOS environment
#   CI=1          Same as --yes

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIMOS_AR_ROOT="${ROOT}/dimos-ar"
source "$(dirname "${BASH_SOURCE[0]}")/dimos_lib.sh"

NON_INTERACTIVE=0
DO_CHECK=0
FLAG_DIMOS_PYTHON=""
FLAG_CLONE_DIR=""
FLAG_DIMOS_REF=""

if [[ "${CI:-}" == "1" ]]; then
  NON_INTERACTIVE=1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)
      NON_INTERACTIVE=1
      shift
      ;;
    --check)
      DO_CHECK=1
      shift
      ;;
    --dimos-ref)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "--dimos-ref requires a branch, tag, or SHA" >&2
        exit 1
      fi
      FLAG_DIMOS_REF="$2"
      shift 2
      ;;
    --dimos-python)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "--dimos-python requires a path argument" >&2
        exit 1
      fi
      FLAG_DIMOS_PYTHON="$2"
      shift 2
      ;;
    --clone-dir)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "--clone-dir requires a path argument" >&2
        exit 1
      fi
      FLAG_CLONE_DIR="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Try: $0 --help" >&2
      exit 1
      ;;
  esac
done

if [[ -n "${FLAG_DIMOS_PYTHON}" && -n "${FLAG_CLONE_DIR}" ]]; then
  echo "Use either --dimos-python or --clone-dir, not both." >&2
  exit 1
fi

DEFAULT_DIMOS_DIR="$(cd "${ROOT}/.." && pwd)/dimos"

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

python_has_dimos_ar() {
  local py="${1:-}"
  [[ -n "${py}" && -x "${py}" ]] || return 1
  "${py}" -c "import dimos.ar" >/dev/null 2>&1
}

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

print_green() {
  if _color_enabled 1; then
    printf '\033[32m%s\033[0m\n' "$1"
  else
    printf '%s\n' "$1"
  fi
}

print_red() {
  if _color_enabled 1; then
    printf '\033[31m%s\033[0m\n' "$1"
  else
    printf '%s\n' "$1"
  fi
}

run_check() {
  echo "Starting setup check…"
  local dimos_py=""
  local dimos_status="not found"
  local ar_status="not installed"
  local check_ok=0
  local dimos_version=""
  local dimos_ref=""

  if [[ -n "${FLAG_DIMOS_PYTHON}" ]]; then
    DIMOS_PYTHON="${FLAG_DIMOS_PYTHON}"
  fi

  if dimos_py="$(find_dimos_python "${ROOT}" 2>/dev/null)"; then
    dimos_status="installed (${dimos_py})"
    dimos_version="$("${dimos_py}" - <<'PY' 2>/dev/null || true
from importlib.metadata import PackageNotFoundError, version
try:
    print(version("dimos"), end="")
except PackageNotFoundError:
    pass
PY
)"
    dimos_ref="$("${dimos_py}" - <<'PY' 2>/dev/null || true
import inspect
import pathlib
import subprocess
import dimos

src = pathlib.Path(inspect.getfile(dimos)).resolve().parent.parent
if not (src / ".git").is_dir():
    print("wheel", end="")
    raise SystemExit(0)

def git(*args: str) -> str:
    return subprocess.check_output(["git", "-C", str(src), *args], text=True).strip()

try:
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    desc = git("describe", "--always", "--dirty")
    print(f"{branch} {desc}", end="")
except subprocess.CalledProcessError:
    print("unknown", end="")
PY
)"
    if python_has_dimos_ar "${dimos_py}"; then
      ar_status="installed"
      check_ok=1
    else
      ar_status="not installed"
    fi
  fi

  echo "DimOS: ${dimos_status}"
  if [[ -n "${dimos_version}" ]]; then
    echo "DimOS version: ${dimos_version}"
  fi
  if [[ -n "${dimos_ref}" ]]; then
    echo "DimOS ref: ${dimos_ref}"
  fi
  echo "dimos-ar: ${ar_status}"
  if openai_api_key_is_set "${ROOT}"; then
    print_green "OPENAI_API_KEY = true"
  else
    print_red "OPENAI_API_KEY = false"
  fi
  echo "CHECK_OK=${check_ok}"
  if [[ -n "${dimos_py}" ]]; then
    echo "DIMOS_PYTHON=${dimos_py}"
  fi
  if [[ -n "${dimos_version}" ]]; then
    echo "DIMOS_VERSION=${dimos_version}"
  fi
  if [[ -n "${dimos_ref}" ]]; then
    echo "DIMOS_REF=${dimos_ref}"
  fi

  if [[ "${check_ok}" -eq 1 ]]; then
    print_green "Setup check successful"
    exit 0
  fi
  print_red "Setup check failed"
  exit 1
}

if [[ "${DO_CHECK}" -eq 1 ]]; then
  run_check
fi

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

is_dimos_source_tree() {
  local dir="$1"
  [[ -d "${dir}/.git" ]] && [[ -f "${dir}/pyproject.toml" ]]
}

ensure_dimos_clone() {
  local dimos_dir="$1"

  if is_dimos_source_tree "${dimos_dir}"; then
    echo "Reusing existing DimOS clone: ${dimos_dir}" >&2
    checkout_dimos_ref "${dimos_dir}"
    printf '%s\n' "${dimos_dir}"
    return 0
  fi

  if [[ -e "${dimos_dir}" ]]; then
    if [[ -d "${dimos_dir}" ]] && [[ -z "$(ls -A "${dimos_dir}")" ]]; then
      :
    else
      echo "Refusing to clone into non-empty path: ${dimos_dir}" >&2
      echo "Pass --clone-dir to an empty directory, or remove the existing path." >&2
      exit 1
    fi
  fi

  echo "Cloning DimOS into: ${dimos_dir}" >&2
  git clone "https://github.com/dimensionalOS/dimos" "${dimos_dir}" 1>&2
  checkout_dimos_ref "${dimos_dir}"
  printf '%s\n' "${dimos_dir}"
}

checkout_dimos_ref() {
  local dimos_dir="$1"
  local ref="${FLAG_DIMOS_REF:-}"
  [[ -n "${ref}" ]] || return 0
  echo "Checking out DimOS ref: ${ref}" >&2
  git -C "${dimos_dir}" fetch --tags origin 1>&2
  git -C "${dimos_dir}" checkout "${ref}" 1>&2
}

install_dimos_editable() {
  local dimos_dir="$1"
  local target_python="$2"
  echo "Installing DimOS from source (editable) into: ${target_python}" >&2
  (
    cd "${dimos_dir}"
    "${target_python}" -m pip install -e ".[base,unitree]" 1>&2
  )
}

install_dimos_from_clone() {
  local dimos_dir="$1"
  local bootstrap_python="$2"
  local dimos_python="${dimos_dir}/.venv/bin/python3"

  ensure_dimos_clone "${dimos_dir}" >/dev/null
  if [[ ! -x "${dimos_python}" ]]; then
    "${bootstrap_python}" -m venv "${dimos_dir}/.venv"
  fi
  install_dimos_editable "${dimos_dir}" "${dimos_python}"
  printf '%s\n' "${dimos_python}"
}

resolve_dimos_python() {
  local found=""
  local bootstrap_python=""
  local dimos_dir=""

  if [[ -n "${FLAG_DIMOS_PYTHON}" ]]; then
    if [[ ! -x "${FLAG_DIMOS_PYTHON}" ]]; then
      echo "Not executable: ${FLAG_DIMOS_PYTHON}" >&2
      exit 1
    fi
    if ! python_has_dimos "${FLAG_DIMOS_PYTHON}"; then
      echo "Warning: not a DimOS environment (no 'dimos' package): ${FLAG_DIMOS_PYTHON}" >&2
      echo "Looking for an installed DimOS Python instead…" >&2
      if found="$(
        unset DIMOS_PYTHON
        find_dimos_python "${ROOT}" 2>/dev/null
      )"; then
        echo "Using detected DimOS Python: ${found}" >&2
        FLAG_DIMOS_PYTHON="${found}"
      else
        echo "No DimOS install found." >&2
        echo "Pass a DimOS venv python (…/dimos/.venv/bin/python3), or use --clone-dir / the launcher Download option." >&2
        exit 1
      fi
    fi
    printf '%s\n' "${FLAG_DIMOS_PYTHON}"
    return 0
  fi

  if [[ -n "${FLAG_CLONE_DIR}" ]]; then
    if ! bootstrap_python="$(find_python_for_venv)"; then
      echo "Could not find Python 3.12+ on PATH. Install Python 3.12+ and re-run ./launcher/scripts/setup.sh." >&2
      exit 1
    fi
    FLAG_DIMOS_REF="${FLAG_DIMOS_REF:-main}"
    install_dimos_from_clone "${FLAG_CLONE_DIR}" "${bootstrap_python}"
    return 0
  fi

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
    found="$(prompt_for_existing_dimos_python)"
    printf '%s\n' "${found}"
    return 0
  fi

  if ! bootstrap_python="$(find_python_for_venv)"; then
    echo "Could not find Python 3.12+ on PATH. Install Python 3.12+ and re-run ./launcher/scripts/setup.sh." >&2
    exit 1
  fi

  dimos_dir="$(prompt_with_default "Where should DimOS be cloned?" "${DEFAULT_DIMOS_DIR}")"
  FLAG_DIMOS_REF="$(prompt_with_default "DimOS git ref (branch, tag, or SHA)?" "${FLAG_DIMOS_REF:-main}")"
  install_dimos_from_clone "${dimos_dir}" "${bootstrap_python}"
}

echo "Resolving DimOS environment..."
if [[ -n "${FLAG_DIMOS_REF}" ]]; then
  echo "DimOS ref: ${FLAG_DIMOS_REF}"
fi
DIMOS_ENV_PYTHON="$(resolve_dimos_python)"

echo "Using DimOS Python: ${DIMOS_ENV_PYTHON}"

echo "Installing dimos-ar into that environment..."
(
  cd "${DIMOS_AR_ROOT}"
  "${DIMOS_ENV_PYTHON}" -m pip install -e ".[dev]"
)

if ! python_has_dimos_ar "${DIMOS_ENV_PYTHON}"; then
  echo "DimOS at ${DIMOS_ENV_PYTHON} cannot import dimos.ar after install." >&2
  echo "The selected DimOS ref may be incompatible with this dimos-ar package." >&2
  exit 1
fi

echo "Running unit tests..."
(
  cd "${DIMOS_AR_ROOT}"
  "${DIMOS_ENV_PYTHON}" -m pytest
)

cat <<EOF

Setup complete.

Next steps:
  ./launcher/scripts/start.sh
  ./launcher/scripts/start-launcher.sh

If DimOS lives somewhere unusual, you can always override auto-detection with:
  DIMOS_PYTHON=/path/to/dimos/.venv/bin/python3 ./launcher/scripts/start.sh
EOF
