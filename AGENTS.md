# Agent instructions for EVM and Solana Wallet Generator

These instructions apply to this repository. Follow the user's requested scope;
use only the unified CLI documented in README.md. This is an offline EVM/Solana wallet
tool, not a trading client. It does not need RPC access or a database.

## Entry points and scope

- Read README.md before operating the tool; use `node bin/wallet-gen.js --help`
  and `<command> --help` for exact options.
- Commands: `generate`, `derive`, `import`, `verify`, `pack`, `export`.
- Run commands in this repository; run Git commands here, not in the parent workspace.
- An assessment request does not authorize generating wallets or changing files.
- When asked to generate/derive wallets, execute the requested count and index range
  using a fresh batch directory. Do not add unrelated wallet operations.
- Do not commit, push, publish, upload wallets, or alter other repositories unless
  the user requests it. Preserve unrelated changes and existing wallet outputs.

## Secret handling

- Never read or print mnemonic/password/key file contents in tool output, logs,
  chat, diffs or reports. Pass their paths to the CLI instead.
- Never put phrases or passwords in command-line arguments. Use already configured
  environment variable names or secret file paths supplied by the user.
- Do not invent production passwords or reuse test fixture keys for user wallets.
- For unattended generation, if the user has not supplied a secret source, ask for
  the path or variable name; do not ask them to paste a secret into chat. A human
  can alternatively run the CLI in an interactive terminal with its hidden prompt.
- `generate` writes a plaintext mnemonic backup with mode 0600 inside its private
  batch directory. Report the backup path, never its contents. `derive` only copies
  the phrase when explicitly requested with `--write-mnemonic`.
- Never include the mnemonic in the ZIP. The ZIP contains encrypted chain-specific keystores
  and public metadata; it is not itself an encrypted container.

## Operating workflow

1. Resolve the intended chain (`evm` default or explicit `solana`), count, output directory and, for derive, start index from
   the request. Defaults are count 1 and index 0; explicitly state assumptions.
2. Use `--dry-run` when a preview is useful. It validates parameters but does not
   read secrets, generate wallets or validate filesystem permissions.
3. Use `generate` or `derive` with file/env secret inputs. Nonzero exit means failure.
4. Verify the keystore directory with the same password source before packaging.
5. Run `pack --in-dir <batch>` when a ZIP is requested. Default output is `<batch>.zip`.
6. Only export plaintext Solana keypairs when the user requests that format. Use
   `export --chain solana --format solana-keypair --allow-plaintext` with a new
   output directory. Never choose plaintext merely to avoid password setup.
7. Solana ZIPs require the updated multi-network wallet manager and an explicitly
   selected Solana network. Never send them through an older EVM-only deployment
   or select an EVM network. Use the distinct formats in docs/solana-format.md.
8. Report counts, public paths and verification outcome. Do not claim online import
   or trading success from local file tests.

Never overwrite a batch or ZIP. An INCOMPLETE marker means generation did not
finish. Preserve that directory and backup; recover to a new directory using the
same phrase/index range. Do not delete or repair user wallet material automatically.

## Development

- `bin/` contains the executable; `src/cli.js` owns command options;
  `src/commands/` owns workflows; `src/chains/` owns EVM and Solana derivation;
  `src/shared/` handles secrets; `src/formats/` handles archives.
- Maintain `m/44'/60'/0'/0/i`, ID/index semantics, Ethereum V3 keystores and the
  documented backend manifest. Do not recreate removed root scripts or legacy flags.
- Use Node.js 20.19 or newer.
- Keep cryptography in established libraries. New chain support requires its own
  implementation and explicit key format; never lowercase Solana addresses.
- Tests must use public test vectors and temporary output directories. They must
  never consume user wallet backups or connect to production services.
- After code changes run `npm test`, `npm run check`, and `git diff --check`.
  Validate documentation links when changing docs. Tests require Python 3 for ZIP inspection.
- Keep README.md and docs/usage.md synchronized with command behavior.

## Existing Solana wallets

Use `import --chain solana --keypair-file <path> --out-dir <new batch>` for an
existing keypair. Do not use `generate`, invent a mnemonic, or fabricate an HD
path for it. Use `--expected-address` when the public address is known. Password
handling follows generation. Verify, then pack; never package the plaintext
source. Imported-keypair v2 support must be deployed in the backend before a
dashboard upload. Report local validation separately from online import.
