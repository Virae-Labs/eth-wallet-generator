# Backend import contract

Run `generate` or `derive`, then `verify`, then `pack`. Upload the resulting ZIP
through the trading-bot wallet upload flow. Do not upload the plaintext mnemonic.

The archive contains one batch folder with `generation_report.json` and a
`keystore/` directory. The report is an object with a `results` array. Each entry
includes numeric `id`, EVM `address`, `checksumAddress`, `derivationPath`, relative
`keystoreFile`, and `timestamp`. The folder name supplies the default wallet group
name. See [Output format](output-format.md) for the complete schema.

The backend resolves each keystore path relative to the report and decrypts the
Ethereum V3 JSON with the user-provided password. This format is retained because
it is the current integration contract, not a deprecated command interface.

Generation verifies every written keystore. Packaging checks report references and
addresses but does not decrypt files. Run `verify` before packaging an externally
supplied batch. Tests inspect ZIP contents and the report contract locally; they
do not perform a production upload or modify the backend database.

The generator is offline. Select the target network in the updated backend wallet
upload form. Solana packages use `solana_wallet_report.json` and encrypted
`solana-keystore` v1 records as documented in [Solana format](solana-format.md).
They require the backend wallet-network migration and an explicit Solana network
(`solana:mainnet-beta`, `solana:devnet`, or `solana:localnet`). Older EVM-only
backends cannot import these packages. Plaintext CLI keypair exports are rejected.

The updated backend supports Solana wallet management, batch password verification
and balances, but not Solana transactions or strategy execution. Upload verifies
format and identity; it does not decrypt keys until password verification. Group
names must be new, and wallet addresses are unique per project and network.
