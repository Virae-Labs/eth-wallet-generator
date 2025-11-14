#!/usr/bin/env bash

set -euo pipefail

COUNT="${1:-2}"
OUT_DIR="${2:-./out_mnemonic_keystore_only}"
KEYSTORE_PASSWORD="${3:-123456}"

node wallet-gen.js \
  --count "${COUNT}" \
  --out-dir "${OUT_DIR}" \
  --modes mnemonic-generate,keystore \
  --keystore-password "${KEYSTORE_PASSWORD}"

ZIP_BASENAME="$(basename "${OUT_DIR}")"
ZIP_FILE="${ZIP_BASENAME}.zip"

if command -v zip >/dev/null 2>&1; then
  # Exclude mnemonic.txt from the archive for safety
  (cd "$(dirname "${OUT_DIR}")" && zip -r "${ZIP_FILE}" "${ZIP_BASENAME}" -x "${ZIP_BASENAME}/mnemonic.txt")
  echo "ZIP created (mnemonic.txt excluded): $(dirname "${OUT_DIR}")/${ZIP_FILE}"
else
  echo "Error: 'zip' command not found. Please install it (e.g., 'brew install zip')." >&2
  exit 1
fi
