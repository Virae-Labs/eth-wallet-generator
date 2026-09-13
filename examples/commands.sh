#!/usr/bin/env bash
# Examples only. Run individual commands from the repository root.
# Generate: node bin/wallet-gen.js generate --count 5 --out-dir ./output/batch-001
# Recover: node bin/wallet-gen.js derive --mnemonic-file /secure/mnemonic.txt --keystore-password-file /secure/password.txt --count 5 --start-index 0 --out-dir ./output/recovered-001
# Verify: node bin/wallet-gen.js verify --in-dir ./output/batch-001/keystore --password-file /secure/password.txt --write-report
# Package: node bin/wallet-gen.js pack --in-dir ./output/batch-001
# Plan: node bin/wallet-gen.js generate --count 100 --dry-run
