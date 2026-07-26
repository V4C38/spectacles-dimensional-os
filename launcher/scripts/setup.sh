#!/usr/bin/env bash
# Set up DimOS + dimos-ar for local development.
#
# Usage:
#   ./launcher/scripts/setup.sh              # interactive first-run setup
#   ./launcher/scripts/setup.sh --yes        # non-interactive; fail fast if DimOS cannot be auto-detected
#   ./launcher/scripts/setup.sh --check      # non-destructive readiness probe (for the web launcher)
#   ./launcher/scripts/setup.sh --yes --stack go2|g1   # install deps for a robot stack
#   ./launcher/scripts/setup.sh --yes --dimos-python <path>   # use existing DimOS interpreter
#   ./launcher/scripts/setup.sh --yes --clone-dir <path>      # clone DimOS here and create .venv
#
# Environment (optional):
#   DIMOS_PYTHON  Path to Python in an existing DimOS environment
#   CI=1          Same as --yes
#
# Stacks:
#   go2  DimOS + dimos-ar (wheel or source is fine)
#   g1   Same as go2, plus DimOS native source (FastLio2 cpp/ + RayTracingVoxelMap rust/)
#        so the G1 nav stack can build native binaries on first launch.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIMOS_AR_ROOT="${ROOT}/dimos-ar"
source "$(dirname "${BASH_SOURCE[0]}")/dimos_lib.sh"

NON_INTERACTIVE=0
DO_CHECK=0
FLAG_DIMOS_PYTHON=""
FLAG_CLONE_DIR=""
FLAG_STACK=""

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
    --stack)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "--stack requires go2 or g1" >&2
        exit 1
      fi
      case "$2" in
        go2|g1) FLAG_STACK="$2" ;;
        *)
          echo "--stack must be 'go2' or 'g1' (got: $2)" >&2
          exit 1
          ;;
      esac
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
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
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
  local native_status="not present"
  local go2_ok=0
  local g1_ok=0

  if [[ -n "${FLAG_DIMOS_PYTHON}" ]]; then
    DIMOS_PYTHON="${FLAG_DIMOS_PYTHON}"
  fi

  if dimos_py="$(find_dimos_python "${ROOT}" 2>/dev/null)"; then
    dimos_status="installed (${dimos_py})"
    if python_has_dimos_ar "${dimos_py}"; then
      ar_status="installed"
      go2_ok=1
      if dimos_has_native_source "${dimos_py}"; then
        native_status="present (source install)"
        g1_ok=1
      else
        native_status="missing (wheel-only — G1 needs DimOS source)"
      fi
    else
      ar_status="not installed"
    fi
  fi

  echo "DimOS: ${dimos_status}"
  echo "dimos-ar: ${ar_status}"
  echo "native source (G1): ${native_status}"
  if openai_api_key_is_set "${ROOT}"; then
    print_green "OPENAI_API_KEY = true"
  else
    print_red "OPENAI_API_KEY = false"
  fi
  echo "CHECK_OK_GO2=${go2_ok}"
  echo "CHECK_OK_G1=${g1_ok}"
  # Legacy: mirrors Go2 readiness so older clients keep working.
  echo "CHECK_OK=${go2_ok}"
  if [[ -n "${dimos_py}" ]]; then
    echo "DIMOS_PYTHON=${dimos_py}"
  fi

  if [[ "${go2_ok}" -eq 1 ]]; then
    print_green "Setup check successful (Go2 ready)"
    if [[ "${g1_ok}" -eq 0 ]]; then
      echo "G1 not ready — install G1 dependencies to add native DimOS source."
    fi
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
  # Clone DimOS source into dimos_dir if missing; reuse an existing clone.
  # Does not create a venv — caller decides where to pip-install.
  # When allow_fallback=1 and dimos_dir is occupied by a non-source tree
  # (e.g. a wheel-only .venv), clone into "${dimos_dir}-source" instead.
  local dimos_dir="$1"
  local allow_fallback="${2:-0}"

  if is_dimos_source_tree "${dimos_dir}"; then
    echo "Reusing existing DimOS clone: ${dimos_dir}" >&2
    printf '%s\n' "${dimos_dir}"
    return 0
  fi

  if [[ -e "${dimos_dir}" ]]; then
    if [[ -d "${dimos_dir}" ]] && [[ -z "$(ls -A "${dimos_dir}")" ]]; then
      :
    elif [[ "${allow_fallback}" -eq 1 ]]; then
      local fallback="${dimos_dir}-source"
      echo "Path ${dimos_dir} is occupied and is not a DimOS source tree." >&2
      echo "Cloning DimOS source into fallback: ${fallback}" >&2
      ensure_dimos_clone "${fallback}" 0
      return $?
    else
      echo "Refusing to clone into non-empty path: ${dimos_dir}" >&2
      echo "Pass --clone-dir to an empty directory, or remove the existing path." >&2
      exit 1
    fi
  fi

  echo "Cloning DimOS into: ${dimos_dir}" >&2
  git clone "https://github.com/dimensionalOS/dimos" "${dimos_dir}" 1>&2
  printf '%s\n' "${dimos_dir}"
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
  # Fresh clone + new .venv (Go2/G1 first-time install).
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

upgrade_dimos_to_source() {
  # In-place wheel → source upgrade for G1. Reuses the existing venv.
  local target_python="$1"
  local dimos_dir="${2:-${DEFAULT_DIMOS_DIR}}"
  local src_dir=""

  echo "G1 requires DimOS native source (FastLio2 + RayTracingVoxelMap)." >&2
  echo "Upgrading the existing DimOS install from wheel to editable source…" >&2

  # allow_fallback=1: if dimos_dir already holds a wheel-only venv, clone beside it.
  src_dir="$(ensure_dimos_clone "${dimos_dir}" 1)"
  install_dimos_editable "${src_dir}" "${target_python}"

  if ! dimos_has_native_source "${target_python}"; then
    print_red "G1 upgrade failed: native source still missing after editable install." >&2
    echo "Expected cpp/ under fastlio2 and rust/ under ray_tracing in the DimOS source tree." >&2
    exit 1
  fi
  print_green "DimOS upgraded to source install (G1 native modules available)." >&2
  printf '%s\n' "${target_python}"
}

resolve_dimos_python() {
  local found=""
  local bootstrap_python=""
  local dimos_dir=""
  local stack="${FLAG_STACK:-go2}"

  if [[ -n "${FLAG_DIMOS_PYTHON}" ]]; then
    if [[ ! -x "${FLAG_DIMOS_PYTHON}" ]]; then
      echo "Not executable: ${FLAG_DIMOS_PYTHON}" >&2
      exit 1
    fi
    if ! python_has_dimos "${FLAG_DIMOS_PYTHON}"; then
      echo "Warning: not a DimOS environment (no 'dimos' package): ${FLAG_DIMOS_PYTHON}" >&2
      echo "Looking for an installed DimOS Python instead…" >&2
      # Don't let a bad DIMOS_PYTHON env (same bare interpreter) block detection.
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
    if [[ "${stack}" == "g1" ]] && ! dimos_has_native_source "${FLAG_DIMOS_PYTHON}"; then
      # Upgrade the pointed-at interpreter in place using --clone-dir or default.
      upgrade_dimos_to_source "${FLAG_DIMOS_PYTHON}" "${FLAG_CLONE_DIR:-${DEFAULT_DIMOS_DIR}}"
      return 0
    fi
    printf '%s\n' "${FLAG_DIMOS_PYTHON}"
    return 0
  fi

  if [[ -n "${FLAG_CLONE_DIR}" ]]; then
    if ! bootstrap_python="$(find_python_for_venv)"; then
      echo "Could not find Python 3.12+ on PATH. Install Python 3.12+ and re-run ./launcher/scripts/setup.sh." >&2
      exit 1
    fi
    # Prefer upgrading an existing detected venv for G1 when clone dir is only
    # needed for source; otherwise fresh clone+venv at FLAG_CLONE_DIR.
    if [[ "${stack}" == "g1" ]] && found="$(find_dimos_python "${ROOT}" 2>/dev/null)"; then
      if dimos_has_native_source "${found}"; then
        printf '%s\n' "${found}"
        return 0
      fi
      upgrade_dimos_to_source "${found}" "${FLAG_CLONE_DIR}"
      return 0
    fi
    install_dimos_from_clone "${FLAG_CLONE_DIR}" "${bootstrap_python}"
    return 0
  fi

  if [[ "${NON_INTERACTIVE}" -eq 1 ]]; then
    if found="$(find_dimos_python "${ROOT}")"; then
      if [[ "${stack}" == "g1" ]] && ! dimos_has_native_source "${found}"; then
        if ! bootstrap_python="$(find_python_for_venv)"; then
          echo "Could not find Python 3.12+ on PATH. Install Python 3.12+ and re-run ./launcher/scripts/setup.sh." >&2
          exit 1
        fi
        # No clone dir given: ensure source at default location, upgrade in place.
        # If default clone path is empty/missing, clone there; if the found
        # python already lives under a dir we can reuse, prefer that.
        dimos_dir="${DEFAULT_DIMOS_DIR}"
        upgrade_dimos_to_source "${found}" "${dimos_dir}"
        return 0
      fi
      printf '%s\n' "${found}"
      return 0
    fi
    # Nothing installed yet. With an explicit --stack (launcher one-click),
    # auto-clone to the default directory; bare --yes still fails fast.
    if [[ -n "${FLAG_STACK}" ]]; then
      if ! bootstrap_python="$(find_python_for_venv)"; then
        echo "Could not find Python 3.12+ on PATH. Install Python 3.12+ and re-run ./launcher/scripts/setup.sh." >&2
        exit 1
      fi
      echo "No DimOS install found — cloning into ${DEFAULT_DIMOS_DIR}" >&2
      install_dimos_from_clone "${DEFAULT_DIMOS_DIR}" "${bootstrap_python}"
      return 0
    fi
    print_dimos_python_help "${ROOT}"
    exit 1
  fi

  if ask_yes_no "Is DimOS already installed on this Mac?" "n"; then
    if found="$(find_dimos_python "${ROOT}")"; then
      echo "Detected DimOS Python: ${found}" >&2
      if ask_yes_no "Use this interpreter?" "y"; then
        if [[ "${stack}" == "g1" ]] && ! dimos_has_native_source "${found}"; then
          if ask_yes_no "G1 needs DimOS source (native modules). Upgrade this install in place?" "y"; then
            dimos_dir="$(prompt_with_default "Where should DimOS source be cloned?" "${DEFAULT_DIMOS_DIR}")"
            upgrade_dimos_to_source "${found}" "${dimos_dir}"
            return 0
          fi
          print_red "Cannot continue G1 setup without DimOS native source." >&2
          exit 1
        fi
        printf '%s\n' "${found}"
        return 0
      fi
    else
      echo "Auto-detection did not find DimOS." >&2
    fi
    found="$(prompt_for_existing_dimos_python)"
    if [[ "${stack}" == "g1" ]] && ! dimos_has_native_source "${found}"; then
      if ask_yes_no "G1 needs DimOS source (native modules). Upgrade this install in place?" "y"; then
        dimos_dir="$(prompt_with_default "Where should DimOS source be cloned?" "${DEFAULT_DIMOS_DIR}")"
        upgrade_dimos_to_source "${found}" "${dimos_dir}"
        return 0
      fi
      print_red "Cannot continue G1 setup without DimOS native source." >&2
      exit 1
    fi
    printf '%s\n' "${found}"
    return 0
  fi

  if ! bootstrap_python="$(find_python_for_venv)"; then
    echo "Could not find Python 3.12+ on PATH. Install Python 3.12+ and re-run ./launcher/scripts/setup.sh." >&2
    exit 1
  fi

  dimos_dir="$(prompt_with_default "Where should DimOS be cloned?" "${DEFAULT_DIMOS_DIR}")"
  install_dimos_from_clone "${dimos_dir}" "${bootstrap_python}"
}

echo "Resolving DimOS environment..."
if [[ -n "${FLAG_STACK}" ]]; then
  echo "Target stack: ${FLAG_STACK}"
fi
DIMOS_ENV_PYTHON="$(resolve_dimos_python)"

echo "Using DimOS Python: ${DIMOS_ENV_PYTHON}"

# Final G1 gate: refuse to claim success if native source is still missing.
if [[ "${FLAG_STACK:-}" == "g1" ]] && ! dimos_has_native_source "${DIMOS_ENV_PYTHON}"; then
  print_red "G1 setup incomplete: DimOS native source is missing."
  echo "Re-run with --stack g1 (and optionally --clone-dir <path>) to install DimOS from source." >&2
  exit 1
fi

echo "Installing dimos-ar into that environment..."
(
  cd "${DIMOS_AR_ROOT}"
  "${DIMOS_ENV_PYTHON}" -m pip install -e ".[dev]"
)

echo "Running unit tests..."
(
  cd "${DIMOS_AR_ROOT}"
  "${DIMOS_ENV_PYTHON}" -m pytest
)

cat <<EOF

Setup complete${FLAG_STACK:+ for stack ${FLAG_STACK}}.

Next steps:
  ./launcher/scripts/start.sh${FLAG_STACK:+ --stack ${FLAG_STACK}}
  ./launcher/scripts/start-launcher.sh

If DimOS lives somewhere unusual, you can always override auto-detection with:
  DIMOS_PYTHON=/path/to/dimos/.venv/bin/python3 ./launcher/scripts/start.sh
EOF
