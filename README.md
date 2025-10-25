# eth-wallet-generator

Bulk Ethereum wallet generator with support for:

- Random mnemonic generation and HD derivation
- Keystore (V3 JSON) export with password
- Optional CSV/TXT summaries (can be disabled)

## Install

```sh
npm install
```

## Keystore only from a single random mnemonic

Generate N keystore JSON files derived from one newly generated mnemonic, without CSV/TXT:

```sh
node wallet-gen.js \
	--count 5 \
	--out-dir ./out_mnemonic_keystore_only \
	--modes mnemonic-generate,keystore \
	--keystore-password "StrongPass123"
```

Outputs:
- out_mnemonic_keystore_only/keystore/UTC--...--<address>.json
- generation_report.json (safe by default; excludes secrets unless `--include-private`)

## Notes

- Default derivation path: `m/44'/60'/0'/0/i` starting from `i = 0`.
- To derive from an existing mnemonic: add `--modes mnemonic-derive --mnemonic "..."`.
- Use `--include-private` only if you intentionally want private keys/mnemonic included in summaries (dangerous).
- You can also explicitly enable summaries with `--summary-files` (default is on); disable with `--no-summary-files`.
