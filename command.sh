# Generate 5 keystore files derived from ONE new random mnemonic, without CSV/TXT summaries
node wallet-gen.js --count 2 --out-dir ./out_mnemonic_keystore_only \
  --modes mnemonic-generate,keystore \
  --keystore-password "StrongPass123" \
  --no-summary-files

