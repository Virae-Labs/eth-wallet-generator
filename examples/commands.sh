#!/usr/bin/env bash
# Examples only. Run individual commands from the repository root.
# Generate: node bin/wallet-gen.js generate --count 5 --out-dir ./output/batch-001
# Recover: node bin/wallet-gen.js derive --mnemonic-file /secure/mnemonic.txt --keystore-password-file /secure/password.txt --count 5 --start-index 0 --out-dir ./output/recovered-001
# Verify: node bin/wallet-gen.js verify --in-dir ./output/batch-001/keystore --password-file /secure/password.txt --write-report
# Package: node bin/wallet-gen.js pack --in-dir ./output/batch-001
# Plan: node bin/wallet-gen.js generate --count 100 --dry-run

# Solana encrypted batch:
# node bin/wallet-gen.js generate --chain solana --count 5 --out-dir ./output/solana-001 --keystore-password-file /secure/password.txt
# node bin/wallet-gen.js verify --chain solana --in-dir ./output/solana-001/keystore --password-file /secure/password.txt
# node bin/wallet-gen.js pack --chain solana --in-dir ./output/solana-001
# Explicit plaintext export (only when requested):
# node bin/wallet-gen.js export --chain solana --format solana-keypair --in-dir ./output/solana-001 --out-dir ./output/solana-cli --password-file /secure/password.txt --allow-plaintext
