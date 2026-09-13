# Solana generation and export formats

## Derivation

The tool uses a 12-word BIP39 phrase for new batches, SLIP-0010 Ed25519 derivation,
and `m/44'/501'/i'/0'` with every component hardened. `i` equals the wallet ID and
starts at `--start-index` (default 0). Valid indices are 0 through 2147483647.
Recovery accepts valid English BIP39 phrases; BIP39 passphrases and alternative
wallet derivation paths are not supported. The encryption password is not a BIP39
passphrase and does not change addresses.

The path matches the Solana cookbook and Phantom's bip44Change grouping:

- [Solana BIP44 recovery](https://solana.com/developers/cookbook/wallets/restore-from-mnemonic)
- [Phantom derivation paths](https://help.phantom.com/articles/12988493966227)
- [SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md)

Addresses are canonical Base58-encoded 32-byte public keys and are case-sensitive.
There is no EVM checksumAddress field. The same key can be used on mainnet, devnet
or a local network; generation does not create on-chain accounts, fund SOL, create
token accounts or send transactions. No RPC or fork is required.

## Default: encrypted Solana batch

```text
solana-batch/
├── mnemonic.txt                       # plaintext backup for new generation only
├── solana_wallet_report.json
└── keystore/
    └── 0--<Base58-address>.json
```

`generate --chain solana` and `derive --chain solana` always produce encrypted
keystores. This is a project-defined, versioned format, NOT Ethereum V3 and NOT a
file that Solana CLI or Phantom can import directly.

The public report has this shape (placeholders are illustrative):

```json
{
  "schemaVersion": 1,
  "chain": "solana",
  "keyFormat": "solana-keystore",
  "derivationPathTemplate": "m/44'/501'/{index}'/0'",
  "results": [
    {
      "id": 0,
      "address": "<Base58-public-key>",
      "derivationPath": "m/44'/501'/0'/0'",
      "keystoreFile": "keystore/0--<Base58-public-key>.json",
      "timestamp": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

Each keystore is UTF-8 JSON with the following fields:

```json
{
  "format": "solana-keystore",
  "version": 1,
  "chain": "solana",
  "address": "<Base58-public-key>",
  "derivationPath": "m/44'/501'/0'/0'",
  "crypto": {
    "cipher": "aes-256-gcm",
    "kdf": "scrypt",
    "kdfparams": { "N": 131072, "r": 8, "p": 1, "dklen": 32 },
    "salt": "<32-bytes-lowercase-hex>",
    "iv": "<12-bytes-lowercase-hex>",
    "tag": "<16-bytes-lowercase-hex>",
    "ciphertext": "<64-bytes-lowercase-hex>"
  }
}
```

Encryption uses Node.js crypto primitives, a fresh cryptographically random salt
and IV for every file, and a UTF-8 password passed to scrypt without trimming or
Unicode normalization. The plaintext is exactly 64 bytes: a 32-byte Ed25519 seed
followed by its 32-byte public key. AES-GCM authenticates the ciphertext and these
metadata bytes as additional authenticated data (AAD):

```js
Buffer.from(JSON.stringify([
  'solana-keystore', 1, 'solana', address, derivationPath
]), 'utf8')
```

Version 1 readers reject unknown versions, algorithms, KDF parameters, malformed
hex, invalid paths and noncanonical public keys before deriving an encryption key.
The scrypt implementation has a 256 MiB per-operation maximum allocation budget;
its main memory cost is approximately 128 MiB, so keep concurrency low on small
machines. Decryption rebuilds the public key from the seed and checks both the
stored keypair and the declared address. Generation and verification also check a
local Ed25519 signature. JavaScript does not guarantee erasure of all secret copies.

`pack --chain solana` includes only `solana_wallet_report.json` and its referenced
encrypted keystores. The mnemonic and arbitrary extra files are excluded. The ZIP
container is not encrypted. It intentionally contains no `generation_report.json`:
the current EVM-only trading-bot uploader must not interpret it as an EVM batch.
Solana backend import/signing is a separate implementation stage.

## Explicit plaintext export: Solana CLI keypair JSON

```sh
node bin/wallet-gen.js export --chain solana --format solana-keypair \
  --in-dir ./output/solana-batch --out-dir ./output/solana-cli \
  --password-file /secure/password.txt --allow-plaintext
```

This command verifies every encrypted source before creating plaintext output:

```text
solana-cli/
├── solana_keypair_report.json
└── keypairs/
    └── 0--<Base58-address>.json
```

Every keypair file is an unencrypted JSON array of exactly 64 integers, each in
0–255, ordered as seed (32 bytes) plus public key (32 bytes). This is the Solana
CLI keypair representation. It is not a list of 64 addresses, not a 32-byte seed
file, and not a Base58 secret-key string. No Base58 private-key export is provided.

The public report has `schemaVersion: 1`, `chain: "solana"`,
`keyFormat: "solana-keypair"`, `encrypted: false`, `derivationPathTemplate`, and
`results` containing `id`, `address`, `derivationPath`, and relative `keypairFile`.
It contains no private keys or mnemonic. The separate keypair files DO contain
private keys and bypass the original encryption password.

```sh
node bin/wallet-gen.js verify --chain solana --format solana-keypair \
  --in-dir ./output/solana-cli/keypairs
# Optional, if Solana CLI is installed; replace the placeholder filename:
solana-keygen pubkey ./output/solana-cli/keypairs/0--ADDRESS.json
```

The verifier checks length, byte range, public-key consistency and a signature.
Existing outputs are refused; an interrupted export retains INCOMPLETE. Directories
use 0700 and keypair files use 0600. `pack` does not support plaintext export batches.
Never rename a plaintext report to an encrypted report to bypass this boundary.
