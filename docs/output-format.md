# EVM output format

```text
batch-001/
├── mnemonic.txt                 # new generation, or explicit --write-mnemonic
├── generation_report.json
└── keystore/
    └── UTC--<timestamp>--<address-without-0x>.json
batch-001.zip
```

Generation writes an `INCOMPLETE` marker first and removes it only after all wallet
files have been written, decrypted successfully, and the final report is saved.
Failed generation never silently reports completion. The report uses the object structure documented below.

## Manifest

The existing backend contract is preserved:

```json
{
  "derivationBase": "m/44'/60'/0'/0",
  "results": [
    {
      "id": 0,
      "address": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      "checksumAddress": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "derivationPath": "m/44'/60'/0'/0/0",
      "keystoreFile": "keystore/UTC--<timestamp>--<address>.json",
      "timestamp": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

The example address is a publicly known test account, not a production wallet.
`id` equals the derivation index; report order is ascending regardless of concurrent
completion order. `address` is lowercase EVM hex and `checksumAddress` is EIP-55.
`keystoreFile` is a POSIX path relative to the report. The report contains no phrase,
private key, or encryption password. V3 keystores retain the ethers output format.

## Archive layout

The ZIP contains the batch directory, its `generation_report.json`, and only the
keystore files listed in that report. This preserves the backend's default wallet
group naming behavior. No mnemonic, unlisted files, or verification reports are
included. Existing archives are never updated in place, so old entries cannot survive
into a new archive. Packaging requires an object manifest with a `results` array.

## Format invariants

Keep the derivation path, indices, public addresses and V3 encoding unchanged when
refactoring. Encryption randomness means keystore bytes may differ even for the same
wallet/password; compare decrypted addresses and signatures, not ciphertext bytes.
Solana uses a separate chain implementation and versioned format; see
[Solana export formats](solana-format.md).
