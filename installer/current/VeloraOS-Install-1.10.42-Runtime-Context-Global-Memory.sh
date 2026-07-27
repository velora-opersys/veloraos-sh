#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
TMP="$(mktemp -d /tmp/veloraos-1.10.42-install.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
BASE="$TMP/base.sh"
curl -fsSL --retry 3 --proto '=https' --tlsv1.2 \
  'https://raw.githubusercontent.com/velora-opersys/veloraos-sh/main/installer/current/VeloraOS-Install-1.10.41-Quiet-Chat-Notifications.sh' -o "$BASE"
printf '%s  %s\n' '138c17b31e749f24475c8bc412bf11174ef2e4d6dac78f065d72a42b36e4e583' "$BASE" | sha256sum -c - >/dev/null
chmod 0755 "$BASE"
/bin/bash "$BASE" "$@"
UPD="$TMP/update.sh"
curl -fsSL --retry 3 --proto '=https' --tlsv1.2 \
  'https://raw.githubusercontent.com/velora-opersys/veloraos-sh/main/installer/update/VeloraOS-Update-1.10.42-Runtime-Context-Global-Memory.sh' -o "$UPD"
printf '%s  %s\n' 'c04c4d25d6b2e18d77735f592cddcf8aaa9491f0f8b01fce1a12c187e5d9da44' "$UPD" | sha256sum -c - >/dev/null
/bin/bash "$UPD" --non-interactive
