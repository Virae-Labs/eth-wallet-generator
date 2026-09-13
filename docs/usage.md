# Command reference

Use `node bin/wallet-gen.js <command> --help`, or
`npm run wallet -- <command> ...`.

## generate / derive

| Option | Meaning / default |
| --- | --- |
| `--count` | Positive integer, 1–100000; default 1 |
| `--start-index` | First derivation index and ID; default 0 |
| `--out-dir` | New batch directory; default `./wallets_out` |
| `--concurrency` | Parallel wallet operations, 1–16; default 2 |
| `--keystore-password-file` | Read password from a UTF-8 file |
| `--keystore-password-env` | Read password from the named environment variable |
| `--dry-run` | Plan only; no secret input or file writes |
| `--mnemonic-file` | Derive only: read a phrase from a UTF-8 file |
| `--mnemonic-env` | Derive only: read the named environment variable |
| `--write-mnemonic` | Derive only: explicitly copy the phrase into the batch |

Only one input source per secret may be selected. Missing inputs prompt invisibly
on an interactive terminal; non-interactive runs fail instead of using defaults.
Passwords must be nonempty. A password file loses one trailing newline but retains
other whitespace. Mnemonic whitespace is normalized. No secrets are logged.
The index range must stay below 2147483648. Count is a validation ceiling, not a
performance guarantee: start with a small batch and low encryption concurrency.

## verify

```sh
node bin/wallet-gen.js verify --in-dir ./output/batch-001/keystore \
  --password-file /secure/password.txt --write-report
```

Supports `--pattern`, `--concurrency`, `--max-files`,
`--per-file-timeout-ms`, `--password-file`, `--password-env`,
`--write-report`, and `--jsonl` options. Missing passwords use the hidden prompt.
Without `--max-files`, all matching files are checked. Verification checks decryption
and the address stored in each keystore; it does not prove ownership on any network.

The per-file time budget is checked after decryption finishes. It is not a hard
cancellation timeout: waiting for the cryptographic operation preserves the
concurrency limit and prevents abandoned decryptions accumulating in memory.

Exit codes: 0 = all selected files verified; 2 = no matching files, a failed
keystore, address mismatch, or exceeded per-file budget; 1 = setup/argument failure.

## pack

```sh
node bin/wallet-gen.js pack --in-dir ./output/batch-001
```

Default destination is `<batch-directory>.zip`; override with `--out-file`.
The destination must not exist. The packer validates the manifest, unique IDs and
addresses, safe relative paths, V3 keystore structure and matching addresses.
Only manifest-listed keystores and a public metadata report are included.
It does not decrypt keystores: run `verify` first for old or externally supplied batches.
No shell `zip` installation is required.

## Failure and recovery

- Existing batch or ZIP: choose a new destination. There is intentionally no force flag.
- Interrupted generation: the directory retains an `INCOMPLETE` marker and any
  keys already written. Preserve the mnemonic backup. Do not import this batch;
  recover into a new directory with the same phrase and index range.
- Failed archive output: a partial ZIP may remain and must not be used. Retry
  to a different output file after resolving the filesystem problem.
- Incorrect password: verification fails without printing decrypted key material.
- Secrets required in automation: supply file/env inputs; do not rely on a TTY.
- High memory usage: reduce `--concurrency`; keystore encryption is intentionally
  expensive. Random sleeps are not used as a security mechanism.

## Operational boundaries

Keep the batch directory private. Directories are created with mode 0700; keystores,
mnemonic, generation report and ZIP use 0600 (subject to stricter process umask).
The plaintext mnemonic bypasses keystore password protection: secure it separately.
Use fresh batches for tests; never use keys copied from historical example scripts
for real assets. Do not include secrets or output archives in Git.
