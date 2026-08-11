#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_VERSION="1.16.0"
UPDATER_URL="https://raw.githubusercontent.com/velora-opersys/veloraos-sh/main/installer/update/VeloraOS-Update-1.16.0-Platform-Update.sh"
UPDATER_SHA256="c3236f70a363916f687d0d4b975cc88bcec1d5ff7aa56fb119e8afb988aa8ba4"
APP_ROOT="/opt/veloraos"
STATE_DIR="/var/lib/veloraos"
TMPDIR="$(mktemp -d /tmp/veloraos-rollback-1160.XXXXXX)"
UPDATER="$TMPDIR/VeloraOS-Update-1.16.0-Platform-Update.sh"
PAYLOAD="$TMPDIR/payload.tar.gz"

log(){ printf '[VeloraOS rollback] %s\n' "$*"; }
die(){ printf '[VeloraOS rollback] ERROR: %s\n' "$*" >&2; exit 1; }
cleanup(){ rm -rf "$TMPDIR" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

[[ ${EUID:-$(id -u)} -eq 0 ]] || die 'Run this rollback with sudo/root.'
[[ -f "$APP_ROOT/app/main.py" ]] || die 'VeloraOS is not installed at /opt/veloraos.'
[[ -r /etc/veloraos/license ]] || die 'The VeloraOS licence file is missing; rollback was not started.'
for command in curl sha256sum awk base64 tr stat tar grep systemctl; do
  command -v "$command" >/dev/null 2>&1 || die "Required command is missing: $command"
done

CURRENT_VERSION="$(cat "$APP_ROOT/VERSION" 2>/dev/null || true)"
if [[ -z "$CURRENT_VERSION" ]]; then
  CURRENT_VERSION="$(sed -nE 's/^VERSION[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$APP_ROOT/app/main.py" | head -1)"
fi
CURRENT_VERSION="${CURRENT_VERSION:-unknown}"

if [[ "$CURRENT_VERSION" == "$TARGET_VERSION" ]]; then
  log 'This instance is already running VeloraOS 1.16.0. Nothing was changed.'
  exit 0
fi
case "$CURRENT_VERSION" in
  2.0.*|2.*) ;;
  *)
    [[ "${VELORAOS_FORCE_ROLLBACK:-0}" == "1" ]] || die "This rollback is intended for VeloraOS 2.x (detected: $CURRENT_VERSION)."
    ;;
esac

log "Preparing in-place rollback from VeloraOS $CURRENT_VERSION to $TARGET_VERSION."
log 'Your accounts, chats, Knowledge, Continuity keys, Time Machine data, flows, plugins, licence and device identity will be preserved.'

systemctl stop veloraos-gpu-setup.service >/dev/null 2>&1 || true

log 'Downloading the original verified VeloraOS 1.16.0 updater.'
curl -fL --retry 3 --retry-delay 2 \
  -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' \
  "$UPDATER_URL" -o "$UPDATER"

ACTUAL_SHA256="$(sha256sum "$UPDATER" | awk '{print $1}')"
[[ "$ACTUAL_SHA256" == "$UPDATER_SHA256" ]] || die "The downloaded 1.16.0 updater checksum did not match. Expected $UPDATER_SHA256, got $ACTUAL_SHA256. Nothing was installed."

grep -Fqx 'VERSION="1.16.0"' "$UPDATER" || die 'The downloaded updater does not declare VeloraOS 1.16.0.'
grep -Eq '^PAYLOAD_SHA256="[0-9a-f]{64}"$' "$UPDATER" || die 'The 1.16.0 updater does not declare its embedded payload checksum.'
grep -Eq '^PAYLOAD_BYTES="[0-9]+"$' "$UPDATER" || die 'The 1.16.0 updater does not declare its embedded payload size.'
grep -Fqx '__VELORA_PAYLOAD_BELOW__' "$UPDATER" || die 'The 1.16.0 embedded application payload marker is missing.'

DECLARED_PAYLOAD_SHA="$(sed -nE 's/^PAYLOAD_SHA256="([0-9a-f]{64})"$/\1/p' "$UPDATER" | head -1)"
DECLARED_PAYLOAD_BYTES="$(sed -nE 's/^PAYLOAD_BYTES="([0-9]+)"$/\1/p' "$UPDATER" | head -1)"
awk '{line=$0; sub(/\r$/, "", line)} line=="__VELORA_PAYLOAD_BELOW__" {found=1; next} found {print} END {if (!found) exit 2}' "$UPDATER" \
  | tr -d '[:space:]' | base64 --decode > "$PAYLOAD" \
  || die 'The 1.16.0 embedded application payload could not be decoded.'
[[ "$(stat -c '%s' "$PAYLOAD")" == "$DECLARED_PAYLOAD_BYTES" ]] || die 'The 1.16.0 embedded payload size did not match its declaration.'
[[ "$(sha256sum "$PAYLOAD" | awk '{print $1}')" == "$DECLARED_PAYLOAD_SHA" ]] || die 'The 1.16.0 embedded payload checksum did not match its declaration.'
tar -tzf "$PAYLOAD" >/dev/null || die 'The 1.16.0 embedded payload archive is invalid.'
tar -tzf "$PAYLOAD" | grep -Fqx 'app/main.py' || die 'The 1.16.0 application payload is incomplete.'
tar -xOf "$PAYLOAD" app/main.py | grep -Fq 'VERSION = "1.16.0"' || die 'The embedded application is not VeloraOS 1.16.0.'

log 'Verification passed. Starting the backed-up in-place replacement.'
/bin/bash "$UPDATER" --non-interactive

[[ "$(cat "$APP_ROOT/VERSION" 2>/dev/null || true)" == "$TARGET_VERSION" ]] || die 'The installer returned, but /opt/veloraos does not report version 1.16.0.'

systemctl disable --now veloraos-gpu-setup.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/veloraos-gpu-setup.service /usr/local/sbin/veloraos-gpu-setup
systemctl daemon-reload >/dev/null 2>&1 || true

if tar -tzf "$PAYLOAD" | grep -Fqx 'bin/veloraos-gpu-setup'; then
  tar -xOf "$PAYLOAD" bin/veloraos-gpu-setup > "$TMPDIR/veloraos-gpu-setup-1160"
  chmod 0755 "$TMPDIR/veloraos-gpu-setup-1160"
  "$TMPDIR/veloraos-gpu-setup-1160" --quiet >/dev/null 2>&1 || "$TMPDIR/veloraos-gpu-setup-1160" >/dev/null 2>&1 || true
fi

rm -f "$STATE_DIR/update-state.json"
systemctl restart veloraos.service

for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:8100/api/health 2>/dev/null | grep -Fq '"version":"1.16.0"'; then
    log 'Rollback complete. VeloraOS 1.16.0 is healthy.'
    log 'Refresh the browser once. The 1.16.0 service worker will discard Aurora shell caches.'
    exit 0
  fi
  sleep 1
done

die 'VeloraOS 1.16.0 was installed, but its final health check did not pass. The installer backup remains available under /opt/veloraos-install-backups.'
