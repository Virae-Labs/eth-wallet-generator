# EVM and Solana Wallet Generator

An offline CLI for generating and recovering batches of EVM and Solana wallets,
verifying encrypted keystores, and creating ZIP files for the trading-bot backend.
Ethereum, Base and other EVM networks use the same keys and addresses. Generation
requires no RPC, database, gas or network connection. Select `--chain solana` for Solana; `--chain evm` is the default.

## Install

Use Node.js 20.19 or newer. Install the locked dependencies:

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
| `generate` | Create a new shared mnemonic and a batch of encrypted wallets |
| `import` | Encrypt an existing Solana CLI keypair, preserving its address |
| `derive` | Recover or extend wallets from an existing mnemonic |
| `verify` | Decrypt keystores and check their addresses |
| `pack` | Create a fresh encrypted-wallet ZIP, excluding the mnemonic |
| `export` | Explicitly export Solana CLI plaintext keypairs |

Run `node bin/wallet-gen.js <command> --help` for all options. You can also use
`npm run wallet -- <command> ...`. Plaintext secret arguments, mode selectors and
permission overrides are not supported; use secret files, environment variables,
or the interactive hidden prompt.

## EVM: generate, verify and package

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

## Recover or extend an EVM batch

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

## Solana: generate, verify and package

```sh
node bin/wallet-gen.js generate --chain solana --count 5 \
  --out-dir ./output/solana-001 --keystore-password-file /secure/password.txt
node bin/wallet-gen.js verify --chain solana \
  --in-dir ./output/solana-001/keystore --password-file /secure/password.txt
node bin/wallet-gen.js pack --chain solana --in-dir ./output/solana-001
```

This creates encrypted Solana wallets and `solana_wallet_report.json`. It does not
fund wallets or contact a network. The updated trading-bot wallet manager accepts
this encrypted ZIP when a Solana network is selected. The backend must include the
wallet-network migration; older EVM-only deployments reject Solana packages.
Solana transaction execution and strategies are not yet supported.

To recover or extend a Solana batch:

```sh
node bin/wallet-gen.js derive --chain solana --count 5 --start-index 5 \
  --mnemonic-file /secure/solana-mnemonic.txt \
  --keystore-password-file /secure/password.txt --out-dir ./output/solana-002
```

The path is `m/44'/501'/i'/0'`. Keep the original phrase and index range to recover
the same addresses. Solana public keys retain their Base58 letter case.

For a Solana CLI keypair, explicitly export plaintext files from an encrypted batch:

```sh
node bin/wallet-gen.js export --chain solana --format solana-keypair \
  --in-dir ./output/solana-001 --out-dir ./output/solana-cli-001 \
  --password-file /secure/password.txt --allow-plaintext
node bin/wallet-gen.js verify --chain solana --format solana-keypair \
  --in-dir ./output/solana-cli-001/keypairs
```

These keypair JSON files contain unencrypted private keys. They are never produced
by default, and `pack` does not package them. See [Solana formats](docs/solana-format.md)
for the encrypted schema, keypair byte layout and integration boundaries.

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
- [EVM output format and recovery rules](docs/output-format.md)
- [Solana derivation and export formats](docs/solana-format.md)
- [Backend import contract](docs/backend-import.md)
- [Commented command examples](examples/commands.sh)

## Development

```sh
npm run check
npm test
```

`bin/` holds the CLI, `src/commands/` the operations, `src/chains/` the EVM and Solana
implementations, `src/formats/` archive handling, and `src/shared/` secret input.
Test fixtures use public test keys and disposable temporary directories, never
existing user wallets. [AGENTS.md](AGENTS.md) provides operating instructions for AI agents.

## Import an existing Solana wallet

Use `import` for an existing Solana CLI JSON file containing the 64 secret-key
bytes. It creates **one encrypted wallet**, not a new address or mnemonic:

```sh
node bin/wallet-gen.js import --chain solana \
  --keypair-file /secure/deployer.json \
  --out-dir ./output/deployer-001 \
  --keystore-password-file /secure/password.txt
node bin/wallet-gen.js verify --chain solana \
  --in-dir ./output/deployer-001/keystore --password-file /secure/password.txt
node bin/wallet-gen.js pack --chain solana --in-dir ./output/deployer-001
```

Optionally add `--expected-address <public-address>` to reject a different wallet.
`--dry-run` previews the output without reading secrets. Password sources match
`generate`: file, environment variable name, or hidden interactive prompt.
The input must be a regular file, not a symlink; inconsistent keypair bytes are
rejected. Existing output directories are never overwritten. The source keypair
is unchanged and never copied into the ZIP.

Imported wallets use keystore/manifest **v2**, `keySource: "imported-keypair"`,
`derivationPath: null`, and `derivationPathTemplate: null`. AAD authenticates the
version, address, null path and key source. Mnemonic-derived wallets retain v1.
There is no mnemonic recovery for this imported wallet: retain its original keypair
or the encrypted keystore and password. Explicit plaintext `export` also supports
v2 and preserves the imported provenance.

The dashboard backend must support imported-keypair v2 **before uploading this
ZIP**. Older deployments reject it; updating the generator alone is insufficient.
Choose the intended Solana network in the dashboard. Creating a ZIP is offline
and does not import the wallet into the application or change any chain state.
