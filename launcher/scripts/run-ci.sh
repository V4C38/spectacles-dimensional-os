#!/usr/bin/env bash
# Reproduce GitHub Actions CI locally (.github/workflows/ci.yml).
#
# Usage (from repo root):
#   ./launcher/scripts/run-ci.sh
#
# Must run outside the Cursor agent sandbox (normal terminal, or agent with
# unrestricted / "all" permissions). Sandboxed runs fail when DimOS logging
# tries to write under ~/.local/state/dimos/logs/.
#
# Environment (optional):
#   CI_PYTHON   Python 3.12 interpreter (default: python3.12, python3)
#   CI_VENV     Path to reuse/create for dimos-ar deps (default: /tmp/spectacles-dimensional-os-ci-venv)
#   CI_DIMOS_REVISION  Explicit compatibility probe (default: .dimos-revision)
#   CI_DIMOS_SOURCE    Reuse a clean local checkout at that exact revision
#   CI_PLANNING_VENV   Isolated environment for the official mock contract
#   CI_WEBXR_BUILD_DIR  Optional build output directory, to preserve a running headset build
#   CI_PLAYWRIGHT_SYSTEM_DEPS=preinstalled  Use installed OS libraries without sudo; all tests still run

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && /bin/pwd -P)"
DIMOS_AR="${ROOT}/dimos-ar"
LAUNCHER_APP="${ROOT}/launcher/app"
LENS_TESTS="${ROOT}/clients/specs/Tests"
WEBXR_CLIENT="${ROOT}/clients/webxr"
REVIEW_DATA="${ROOT}/Review Data"
CI_VENV="${CI_VENV:-/tmp/spectacles-dimensional-os-ci-venv}"
CI_DIMOS_REVISION="${CI_DIMOS_REVISION:-$(cat "${ROOT}/.dimos-revision")}"
CI_DIMOS_REQUIREMENT="dimos @ git+https://github.com/dimensionalOS/dimos.git@${CI_DIMOS_REVISION}"
CI_DIMOS_PLANNING_REQUIREMENT="dimos[planning] @ git+https://github.com/dimensionalOS/dimos.git@${CI_DIMOS_REVISION}"
if [[ -n "${CI_DIMOS_SOURCE:-}" ]]; then
  if [[ "$(git -C "${CI_DIMOS_SOURCE}" rev-parse HEAD)" != "${CI_DIMOS_REVISION}" ]] || [[ -n "$(git -C "${CI_DIMOS_SOURCE}" status --porcelain)" ]]; then
    echo "CI_DIMOS_SOURCE must be clean and match .dimos-revision (or CI_DIMOS_REVISION)." >&2
    exit 1
  fi
  CI_DIMOS_REQUIREMENT="${CI_DIMOS_SOURCE}"
  CI_DIMOS_PLANNING_REQUIREMENT="${CI_DIMOS_SOURCE}[planning]"
fi
LAUNCHER_VENV="${LAUNCHER_VENV:-/tmp/spectacles-dimensional-os-launcher-ci-venv}"
CI_PLANNING_VENV="${CI_PLANNING_VENV:-/tmp/spectacles-dimensional-os-planning-ci-venv}"

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

check_runtime_tools() {
  local py
  py="$(find_ci_python)"
  "${py}" -c 'import sys; assert sys.version_info[:2] == (3, 12), "CI requires Python 3.12, matching GitHub Actions"'
  node -e 'if (Number(process.versions.node.split(".")[0]) !== 22) throw new Error("CI requires Node 22, matching GitHub Actions")'
  for tool in ffmpeg ffprobe; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
      echo "Missing ${tool}; install ffmpeg before running CI." >&2
      exit 1
    fi
  done
}

hydrate_existing_lfs() {
  local pattern="$1" path
  local paths=()
  git -C "${ROOT}" lfs fetch --include="${pattern}" --exclude=""
  # `lfs pull` also checks out missing files, undoing deliberate working deletions.
  # Fresh checkout pointers exist, so hydrate only tracked files still present.
  while IFS= read -r -d '' path; do
    if [[ -f "${ROOT}/${path}" ]]; then
      paths[${#paths[@]}]="${path}"
    fi
  done < <(git -C "${ROOT}" ls-files -z -- "${pattern}")
  if [[ ${#paths[@]} -gt 0 ]]; then
    git -C "${ROOT}" lfs checkout -- "${paths[@]}"
  fi
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
  # Match fresh GitHub dependencies while keeping the reviewed DimOS baseline.
  # CI_DIMOS_REVISION permits explicit compatibility probes against another commit.
  GIT_LFS_SKIP_SMUDGE=1 pip install --upgrade -r "${DIMOS_AR}/requirements-ci.txt" -e "${CI_DIMOS_REQUIREMENT}" -e ".[dev]"

  ruff check .
  mypy dimos/ar
  pytest --junitxml="${REVIEW_DATA}/unit/backend/junit.xml"
  pytest "${WEBXR_CLIENT}/tools/test_calibrate.py" --junitxml="${REVIEW_DATA}/unit/calibration/junit.xml"
}

run_manipulation_contract_job() {
  local py
  py="$(find_ci_python)"
  echo "==> official mock manipulation contract (no physical hardware)"
  if [[ ! -d "${CI_PLANNING_VENV}" ]]; then
    "${py}" -m venv "${CI_PLANNING_VENV}"
  fi
  "${CI_PLANNING_VENV}/bin/python" -m pip install --upgrade pip
  GIT_LFS_SKIP_SMUDGE=1 "${CI_PLANNING_VENV}/bin/python" -m pip install -e "${CI_DIMOS_PLANNING_REQUIREMENT}" -e "${DIMOS_AR}[manipulation,dev]"
  "${CI_PLANNING_VENV}/bin/python" "${DIMOS_AR}/tools/run_mock_manipulation_contract.py"
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

  hydrate_existing_lfs "assets/markers/**"

  # shellcheck disable=SC1091
  source "${LAUNCHER_VENV}/bin/activate"
  cd "${LAUNCHER_APP}"

  python -m pip install --upgrade pip
  pip install --upgrade -r requirements-dev.txt

  ruff check .
  pytest --junitxml="${REVIEW_DATA}/unit/launcher/junit.xml"
}

run_client_specs_job() {
  echo "==> client-specs-tests job (matches .github/workflows/ci.yml)"
  hydrate_existing_lfs "clients/specs/Assets/Materials/Shaders/*.ss_graph"
  cd "${LENS_TESTS}"
  npm ci
  npm test
  mkdir -p "${REVIEW_DATA}/unit/specs-tooling"
  python3 -m unittest discover -s "${LENS_TESTS}/integration-tests" -p 'test_*.py' 2>&1 | tee "${REVIEW_DATA}/unit/specs-tooling/output.log"
}

run_client_webxr_job() {
  echo "==> client-webxr-tests job (matches .github/workflows/ci.yml)"
  cd "${WEBXR_CLIENT}"
  npm ci
  npm test
  npm run build -- --outDir "${CI_WEBXR_BUILD_DIR:-dist}"
  if [[ "$(uname -s)" == "Linux" && "${CI_PLAYWRIGHT_SYSTEM_DEPS:-install}" != "preinstalled" ]]; then
    npx playwright install --with-deps chromium
  else
    npx playwright install chromium
  fi
  mkdir -p "${REVIEW_DATA}/unit/integration-tooling"
  node --test --test-reporter=spec --test-reporter-destination=stdout \
    --test-reporter=junit --test-reporter-destination="${REVIEW_DATA}/unit/integration-tooling/junit.xml" \
    "${ROOT}/tools/integration-tests/integration.test.mjs" "${ROOT}/tools/visual-review.test.mjs"
  # The active environment belongs to the launcher job; use the backend environment
  # for the real ARModule server spawned by the multi-client browser test.
  DIMOS_PYTHON="${CI_VENV}/bin/python" npm run test:integration
}

check_runtime_tools
run_dimos_ar_job
run_manipulation_contract_job
run_launcher_job
run_client_specs_job
run_client_webxr_job

echo ""
echo "All CI jobs passed."
