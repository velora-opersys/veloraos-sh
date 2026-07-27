#!/usr/bin/env bash
set -Eeuo pipefail
VERSION="1.10.42"
APP_ROOT="/opt/veloraos"
SERVICE="veloraos"
PORT="8100"
PART_BASE="https://raw.githubusercontent.com/velora-opersys/veloraos-sh/main/installer/update"
PAYLOAD_SHA256="a72c3de588fb7aab10b0f89b4d547cf6654e6f1aecb8fb1e3a69b1bea9b6180a"

[[ "${1:-}" == "--non-interactive" || "${VELORAOS_NONINTERACTIVE:-0}" == "1" ]] || {
  echo "Use --non-interactive." >&2
  exit 1
}
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run as root." >&2; exit 1; }

for cmd in curl sha256sum base64 tar python3 systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing required command: $cmd" >&2; exit 1; }
done
[[ -f "$APP_ROOT/app/main.py" ]] || { echo "VeloraOS backend missing." >&2; exit 1; }
[[ -x "$APP_ROOT/.venv/bin/python" ]] || { echo "VeloraOS Python environment missing." >&2; exit 1; }

TMP="$(mktemp -d /tmp/veloraos-1.10.42-deterministic.XXXXXX)"
BACKUP="/opt/veloraos-update-backups/pre-1.10.42-deterministic-$(date +%Y%m%d-%H%M%S)"
SUCCESS=0

cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
rollback() {
  code=$?
  trap - EXIT INT TERM
  if [[ "$SUCCESS" != "1" && -d "$BACKUP" ]]; then
    echo "[VeloraOS 1.10.42] Restoring previous files."
    for rel in app/main.py app/static/app.js app/static/app-110420.js app/static/index.html app/static/style.css app/static/style-110420.css app/static/sw.js VERSION; do
      if [[ -f "$BACKUP/$rel" ]]; then
        mkdir -p "$APP_ROOT/$(dirname "$rel")"
        cp -a "$BACKUP/$rel" "$APP_ROOT/$rel"
      fi
    done
    systemctl restart "$SERVICE" 2>/dev/null || true
  fi
  cleanup
  exit "$code"
}
trap rollback EXIT INT TERM

echo "[VeloraOS 1.10.42] Downloading deterministic payload."
: > "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part01.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part01.b64"
  printf '%s  %s\n' 'b5a3717e76a4b6ce03dcd2003f4a3850bcfec3a6169b30edf038d4ce1f4d4ac2' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part01.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 01 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part01.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part02.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part02.b64"
  printf '%s  %s\n' 'c458afe76b88f34422f3654a1c43335e2c5f66c9db9ccd33662d96b07f0f8938' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part02.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 02 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part02.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part03.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part03.b64"
  printf '%s  %s\n' '184099db30b9d2f7f3fb9c9731db7e8574e1e926d126e72f40e8f68af352f0a1' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part03.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 03 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part03.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part04.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part04.b64"
  printf '%s  %s\n' 'd7ec76ae8951a75ba4067d40096542a0bc26f6d3ba95087a05f77d2b559c0534' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part04.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 04 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part04.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part05.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part05.b64"
  printf '%s  %s\n' '2701e77c3854cdd23220eb457bd175fa0c9ae1856dbd42420ac07ea655132097' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part05.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 05 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part05.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part06.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part06.b64"
  printf '%s  %s\n' 'c582f8b051556faf65b461c22418d536f4a085b739a1baf6d4b97e3cd68a1cf3' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part06.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 06 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part06.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part07.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part07.b64"
  printf '%s  %s\n' '55fb0768d24fd2079dec2a13c482f8d51c9292381da348df0cd9fc58a41787c8' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part07.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 07 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part07.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part08.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part08.b64"
  printf '%s  %s\n' '8afcfd99845cdd9e59b046ace72721e6ae404ed610ddf24a42acf72d3b4e4882' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part08.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 08 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part08.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part09.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part09.b64"
  printf '%s  %s\n' '0c3748149de7f454ec2b22939ca971aa4390a093bbe91d7bbb76eb75b340cc9e' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part09.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 09 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part09.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part10.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part10.b64"
  printf '%s  %s\n' 'c6b993936286324a6ba6296bedbb1ce1b08b498313e78b9a6a6ac0f25ce38ed2' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part10.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 10 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part10.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part11.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part11.b64"
  printf '%s  %s\n' 'e1b594f3745b670941d814717ebf8b2894e71e3b8de381673c45534229003d36' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part11.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 11 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part11.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part12.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part12.b64"
  printf '%s  %s\n' '1d8a3d9c35b48684d4a11892577bd375ab8661a4c4621f549aa92240242b67b2' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part12.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 12 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part12.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part13.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part13.b64"
  printf '%s  %s\n' 'aac38575495f712e8a9193d0cf329a6c4cc21a4dd9b500a517c2bec2db2b9ecc' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part13.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 13 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part13.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part14.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part14.b64"
  printf '%s  %s\n' 'fa0e62c6e20b204b20eaddada9a820fa0759ada57115d7c6bb336c69441e6825' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part14.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 14 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part14.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part15.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part15.b64"
  printf '%s  %s\n' '9e219b0c17e328ce30ea17e0a2776b232bd8df3d30c5558c46243d402f16dd26' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part15.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 15 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part15.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part16.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part16.b64"
  printf '%s  %s\n' 'e3b99eda99ef93d6983f5864f8c846a1c26e9c229225913b08613261e137d4d4' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part16.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 16 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part16.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part17.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part17.b64"
  printf '%s  %s\n' '513786c93c838acdaaae221d7511c322bcba5731ced94465421a644b2da24dfa' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part17.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 17 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part17.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part18.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part18.b64"
  printf '%s  %s\n' '81823352cacaadba45458461da826fbc4663c8c7fd50e3eef7de802dde2c554a' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part18.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 18 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part18.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part19.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part19.b64"
  printf '%s  %s\n' '918256b0ad8a30474db2cc32eb9d3c067daf76cfdb021f741653733ac2fcdd0b' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part19.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 19 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part19.b64" >> "$TMP/payload.b64"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 90 \
    --proto '=https' --tlsv1.2 "$PART_BASE/VeloraOS-1.10.42-Deterministic-Payload.part20.b64" -o "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part20.b64"
  printf '%s  %s\n' '8f071d6a095c1a5b8252132288b16dbacbb4981e5da9696b5190060fe7f9430f' "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part20.b64" | sha256sum -c - >/dev/null || {
    echo "Payload part 20 checksum mismatch." >&2
    exit 1
  }
  cat "$TMP/VeloraOS-1.10.42-Deterministic-Payload.part20.b64" >> "$TMP/payload.b64"

# Reject malformed/truncated Base64 before decoding.
python3 - "$TMP/payload.b64" <<'PYB'
import base64, pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text(encoding="ascii")
if not text or len(text) % 4:
    raise SystemExit("Payload Base64 is malformed or incomplete.")
base64.b64decode(text, validate=True)
PYB

base64 -d "$TMP/payload.b64" > "$TMP/payload.tgz"
printf '%s  %s\n' "$PAYLOAD_SHA256" "$TMP/payload.tgz" | sha256sum -c - >/dev/null || {
  echo "Decoded 1.10.42 payload checksum mismatch." >&2
  exit 1
}

# Confirm the archive really is gzip before tar sees it.
python3 - "$TMP/payload.tgz" <<'PYG'
from pathlib import Path
import sys
data = Path(sys.argv[1]).read_bytes()[:2]
if data != b"\x1f\x8b":
    raise SystemExit("Decoded payload is not a gzip archive.")
PYG

STAGE="$TMP/stage"
mkdir -p "$STAGE"
tar -xzf "$TMP/payload.tgz" -C "$STAGE"

# Validate every staged file before changing the live installation.
for rel in app/main.py app/static/app.js app/static/app-110420.js app/static/index.html app/static/style.css app/static/style-110420.css app/static/sw.js; do
  [[ -f "$STAGE/$rel" ]] || { echo "Missing staged file: $rel" >&2; exit 1; }
done
"$APP_ROOT/.venv/bin/python" -m py_compile "$STAGE/app/main.py"
grep -Fq 'VERSION = "1.10.42"' "$STAGE/app/main.py"
grep -Fq 'def inject_runtime_and_memory' "$STAGE/app/main.py"
grep -Fq '@app.get("/api/memory")' "$STAGE/app/main.py"
grep -Fq 'window.VELORAOS_RELEASE="1.10.42"' "$STAGE/app/static/app.js"
grep -Fq 'function memorySettingsCard()' "$STAGE/app/static/app.js"

mkdir -p "$BACKUP"
for rel in app/main.py app/static/app.js app/static/app-110420.js app/static/index.html app/static/style.css app/static/style-110420.css app/static/sw.js VERSION; do
  if [[ -f "$APP_ROOT/$rel" ]]; then
    mkdir -p "$BACKUP/$(dirname "$rel")"
    cp -a "$APP_ROOT/$rel" "$BACKUP/$rel"
  fi
done

echo "[VeloraOS 1.10.42] Installing verified complete files."
for rel in app/main.py app/static/app.js app/static/app-110420.js app/static/index.html app/static/style.css app/static/style-110420.css app/static/sw.js; do
  dst="$APP_ROOT/$rel"
  mkdir -p "$(dirname "$dst")"
  install -m 0644 "$STAGE/$rel" "$dst.new-1.10.42"
  mv -f "$dst.new-1.10.42" "$dst"
done
[[ -f "$APP_ROOT/VERSION" ]] && printf '1.10.42\n' > "$APP_ROOT/VERSION"

"$APP_ROOT/.venv/bin/python" -m py_compile "$APP_ROOT/app/main.py"
systemctl restart "$SERVICE"

ok=0
last_body=""
for _ in $(seq 1 60); do
  last_body="$(curl -fsS --connect-timeout 2 --max-time 4 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
  if python3 - "$last_body" <<'PYH'
import json, sys
try:
    data = json.loads(sys.argv[1])
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if data.get("status") == "ok" and data.get("version") == "1.10.42" else 1)
PYH
  then
    ok=1
    break
  fi
  sleep 1
done

if [[ "$ok" != "1" ]]; then
  echo "VeloraOS did not report healthy 1.10.42 after installation." >&2
  echo "Last health response: $last_body" >&2
  systemctl --no-pager --full status "$SERVICE" >&2 || true
  journalctl -u "$SERVICE" -n 80 --no-pager >&2 || true
  exit 1
fi

SUCCESS=1
cleanup
trap - EXIT INT TERM
echo "[VeloraOS 1.10.42] Deterministic repair complete."
