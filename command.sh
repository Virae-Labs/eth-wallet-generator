# Generate 10 wallets, output to ./out_hex, including private keys (no mnemonic by default)
node wallet-gen.js --count 10 --out-dir ./out_hex \
  --modes hex \
  --include-private

# Generate 10 keystore files, encrypted with the same password
node wallet-gen.js --count 10 --out-dir ./out_keystore \
  --modes keystore \
  --keystore-password "StrongPass123"

# Generate 10 addresses from the same random mnemonic (saved to file)
node wallet-gen.js --count 10 --out-dir ./out_mnemonic_generate \
  --modes mnemonic-generate \
  --include-private

# Derive 20 addresses from specified mnemonic (starting from index 0)
node wallet-gen.js --count 20 --out-dir ./out_mnemonic_derive \
  --modes mnemonic-derive \
  --mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" \
  --include-private


# Generate 5 keystore files derived from ONE new random mnemonic, without CSV/TXT summaries
node wallet-gen.js --count 2 --out-dir ./out_mnemonic_keystore_only \
  --modes mnemonic-generate,keystore \
  --keystore-password "StrongPass123" \
  --no-summary-files

