# EVM Wallet Generator

An offline CLI for generating and recovering batches of Ethereum-compatible wallets,
verifying encrypted keystores, and creating ZIP files for the trading-bot backend.
Ethereum, Base and other EVM networks use the same keys and addresses. Generation
requires no RPC, database, gas or network connection. Solana is not implemented yet.

## Install

Use Node.js 20 or newer. Install the locked dependencies:

```sh
npm ci
node bin/wallet-gen.js --help
```

Python 3 is needed only for ZIP inspection in the automated tests.

## Commands

The only executable entry point is `bin/wallet-gen.js`. Root-level generation and
ZIP scripts have been removed. Use the subcommands below directly:

| Command | Purpose |
| --- | --- |
| `generate` | Create a new shared mnemonic and a batch of encrypted EVM wallets |
| `derive` | Recover or extend wallets from an existing mnemonic |
| `verify` | Decrypt keystores and check their addresses |
| `pack` | Create a fresh ZIP for the backend, excluding the mnemonic |

Run `node bin/wallet-gen.js <command> --help` for all options. You can also use
`npm run wallet -- <command> ...`. Plaintext secret arguments, mode selectors and
permission overrides are not supported; use secret files, environment variables,
or the interactive hidden prompt.

## Generate, verify and package

Run these commands from this repository. The first command prompts for a hidden
keystore password. Every batch must use a new output directory.

```sh
node bin/wallet-gen.js generate --count 5 --out-dir ./output/batch-001
node bin/wallet-gen.js verify --in-dir ./output/batch-001/keystore
node bin/wallet-gen.js pack --in-dir ./output/batch-001
```

The resulting `output/batch-001.zip` is compatible with the existing trading-bot
wallet ZIP uploader. Keep the generated `mnemonic.txt` in a separate secure backup:
it is plaintext, controls the entire batch, and is never included in the ZIP.
Keystore files are Ethereum V3 password-encrypted JSON files. The ZIP container
itself is not encrypted; addresses and derivation paths are public metadata.

## Recover or extend a batch

Use a securely stored mnemonic file. You can choose a new encryption password;
changing that password does not change the derived addresses.

```sh
node bin/wallet-gen.js derive \
  --mnemonic-file /secure/mnemonic.txt \
  --keystore-password-file /secure/password.txt \
  --count 5 --start-index 0 --out-dir ./output/recovered-001
```

To derive the next five accounts, use `--start-index 5` and a new directory.
The fixed path is `m/44'/60'/0'/0/i`; wallet IDs equal `i` and default to 0 through
`count - 1`. Recovery does not copy the mnemonic unless `--write-mnemonic` is set.
BIP39 passphrases are not supported; the keystore password is a different concept.

## Non-interactive use (automation / AI)

Prepare password and mnemonic files privately outside this repository. Do not paste
their contents into a command, chat or example script. File arguments contain paths,
not the actual secrets:

```sh
node bin/wallet-gen.js generate --count 5 --out-dir ./output/batch-002 \
  --keystore-password-file /secure/password.txt
node bin/wallet-gen.js verify --in-dir ./output/batch-002/keystore \
  --password-file /secure/password.txt --write-report
node bin/wallet-gen.js pack --in-dir ./output/batch-002
```

Alternatively, use `--keystore-password-env KEYSTORE_PASSWORD` for generation and
`--password-env KEYSTORE_PASSWORD` for verification, where the variable is already
populated securely. Recovery supports `--mnemonic-env WALLET_MNEMONIC`. Select only
one source per secret. Without a source, automation fails; interactive terminals
prompt with hidden input. No built-in password or mnemonic is provided.

## Preview without generating secrets

```sh
node bin/wallet-gen.js generate --count 100 --dry-run
```

Dry run validates command parameters and prints the plan. It does not read a
mnemonic/password, create keys, encrypt files, or validate output write permissions.

## Documentation

- [Command reference and troubleshooting](docs/usage.md)
- [Output format and recovery rules](docs/output-format.md)
- [Backend import contract](docs/backend-import.md)
- [Commented command examples](examples/commands.sh)

## Development

```sh
npm run check
npm test
```

`bin/` holds the CLI, `src/commands/` the operations, `src/chains/` the EVM
implementation, `src/formats/` archive handling, and `src/shared/` secret input.
Test fixtures use public test keys and disposable temporary directories, never
existing user wallets. [AGENTS.md](AGENTS.md) provides operating instructions for AI agents.
