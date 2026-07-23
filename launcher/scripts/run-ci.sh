#!/usr/bin/env bash
# Reproduce GitHub Actions CI locally (.github/workflows/ci.yml).
#
# Usage (from repo root):
#   ./launcher/scripts/run-ci.sh
#
# Environment (optional):
#   CI_PYTHON   Python 3.12+ interpreter for the dimos-ar job (default: python3.12, python3)
#   CI_VENV     Path to reuse/create for dimos-ar deps (default: /tmp/spectacles-dimensional-os-ci-venv)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIMOS_AR="${ROOT}/dimos-ar"
LAUNCHER_APP="${ROOT}/launcher/app"
LENS_TESTS="${ROOT}/lens-studio/Tests"
CI_VENV="${CI_VENV:-/tmp/spectacles-dimensional-os-ci-venv}"
LAUNCHER_VENV="${LAUNCHER_VENV:-/tmp/spectacles-dimensional-os-launcher-ci-venv}"

find_ci_python() {
  local candidate=""
  if [[ -n "${CI_PYTHON:-}" ]]; then
    printf '%s\n' "${CI_PYTHON}"
    return 0
  fi
  for candidate in python3.12 python3; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      command -v "${candidate}"
      return 0
    fi
  done
  echo "Could not find Python 3.12+. Set CI_PYTHON to a Python 3.12+ interpreter." >&2
  exit 1
}

run_dimos_ar_job() {
  local py
  py="$(find_ci_python)"
  echo "==> dimos-ar job (matches .github/workflows/ci.yml)"
  echo "    Python: ${py}"
  echo "    venv:   ${CI_VENV}"

  if [[ ! -d "${CI_VENV}" ]]; then
    "${py}" -m venv "${CI_VENV}"
  fi

  # shellcheck disable=SC1091
  source "${CI_VENV}/bin/activate"
  cd "${DIMOS_AR}"

  python -m pip install --upgrade pip
  pip install websockets pytest pytest-asyncio ruff mypy numpy opencv-python-headless Pillow scipy dimos
  pip install -e . --no-deps

  ruff check .
  mypy dimos/ar
  pytest -m "not integration"
}

run_launcher_job() {
  local py
  py="$(find_ci_python)"
  echo "==> launcher job (matches .github/workflows/ci.yml)"
  echo "    Python: ${py}"
  echo "    venv:   ${LAUNCHER_VENV}"

  if [[ ! -d "${LAUNCHER_VENV}" ]]; then
    "${py}" -m venv "${LAUNCHER_VENV}"
  fi

  # shellcheck disable=SC1091
  source "${LAUNCHER_VENV}/bin/activate"
  cd "${LAUNCHER_APP}"

  python -m pip install --upgrade pip
  pip install -r requirements-dev.txt

  ruff check .
  pytest
}

run_lens_studio_job() {
  echo "==> lens-studio-tests job (matches .github/workflows/ci.yml)"
  cd "${LENS_TESTS}"
  npm ci
  npm test
}

run_dimos_ar_job
run_launcher_job
run_lens_studio_job

echo ""
echo "All CI jobs passed."
