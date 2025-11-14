#!/usr/bin/env bash

set -euo pipefail

MNEMONIC="${1:-goose music bench regular globe sure rabbit novel tree country aspect insect}"
COUNT="${2:-5}"
OUT_DIR="${3:-./out_existing}"
KEYSTORE_PASSWORD="${4:-123456}"

node wallet-gen-from-mnemonic.js \
  --mnemonic "${MNEMONIC}" \
  --count "${COUNT}" \
  --out-dir "${OUT_DIR}" \
  --keystore-password "${KEYSTORE_PASSWORD}"

ZIP_BASENAME="$(basename "${OUT_DIR}")"
ZIP_FILE="${ZIP_BASENAME}.zip"

if command -v zip >/dev/null 2>&1; then
  (cd "$(dirname "${OUT_DIR}")" && zip -r "${ZIP_FILE}" "${ZIP_BASENAME}")
  echo "ZIP created: $(dirname "${OUT_DIR}")/${ZIP_FILE}"
else
  echo "Error: 'zip' command not found. Please install it (e.g., 'brew install zip')." >&2
  exit 1
fi
