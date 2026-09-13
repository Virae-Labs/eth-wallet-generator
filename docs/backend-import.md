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

The generator is offline. Select the EVM network in the backend. Solana generation and export are available, but the backend does not yet support
Solana wallet import or transaction signing. Solana packages use a different report
filename and must not be uploaded through the EVM import flow.
