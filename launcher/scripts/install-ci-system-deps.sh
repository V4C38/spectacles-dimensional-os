#!/usr/bin/env bash
# Shared Ubuntu prerequisites for GitHub Actions and the local CI gate.
set -euo pipefail

mode="${1:-planning}"
case "$mode" in planning|webxr) ;; *) echo "Usage: $0 planning|webxr" >&2; exit 2 ;; esac
if [[ "$(uname -s)" != Linux ]]; then exit 0; fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
apt_config="$(mktemp)"
trap 'rm -f "$apt_config"' EXIT
cat > "$apt_config" <<'APT'
Acquire::Retries "2";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT::Update::Error-Mode "any";
APT
chmod 644 "$apt_config"
export APT_CONFIG="$apt_config"

# Keep the same strict network policy in apt spawned by Playwright. Running only
# install-deps as root leaves browser downloads in the normal user's cache.
sudo --preserve-env=APT_CONFIG apt-get update
sudo --preserve-env=APT_CONFIG apt-get install -y --no-install-recommends libegl1 ffmpeg
if [[ "$mode" == webxr ]]; then
  sudo --preserve-env=APT_CONFIG "$(command -v node)" \
    "$root/clients/webxr/node_modules/playwright/cli.js" install-deps chromium
fi
