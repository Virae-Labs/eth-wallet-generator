const { Command, Option, InvalidArgumentError } = require('commander');
const { verify } = require('./commands/verify');
const { generate } = require('./commands/generate');
const { pack } = require('./formats/archive');
const { importKeypair } = require('./commands/import');
const { exportKeypairs } = require('./commands/export');
const chainOption = () => new Option('--chain <chain>', 'wallet chain family').choices(['evm', 'solana']).default('evm');

function integer(min, max = Number.MAX_SAFE_INTEGER) {
  return value => {
    if (!/^\d+$/.test(value)) throw new InvalidArgumentError('Expected an integer.');
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new InvalidArgumentError(`Expected an integer between ${min} and ${max}.`);
    return n;
  };
}
function generationOptions(cmd) {
  return cmd.addOption(chainOption()).option('-c, --count <n>', 'number of wallets', integer(1, 100000), 1)
    .option('--start-index <n>', 'first derivation index and wallet ID', integer(0, 2147483647), 0)
    .option('-o, --out-dir <dir>', 'new batch directory (must not exist)', './wallets_out')
    .option('--keystore-password-file <file>', 'password file; removes one trailing newline')
    .option('--keystore-password-env <name>', 'environment variable containing password')
    .option('--concurrency <n>', 'parallel encryption operations', integer(1, 16), 2)
    .option('--dry-run', 'show plan only; no secrets generated, read or written');
}
async function run(args = process.argv.slice(2)) {
  const program = new Command().name('wallet-gen').description('Offline EVM and Solana wallet generation, recovery, verification and packaging.');
  generationOptions(program.command('generate').description('Generate a new shared mnemonic and encrypted wallets'))
    .action(opts => generate('generate', opts));
  generationOptions(program.command('derive').description('Derive wallets from an existing mnemonic'))
    .option('--mnemonic-file <file>', 'read mnemonic from a file')
    .option('--mnemonic-env <name>', 'environment variable containing mnemonic')
    .option('--write-mnemonic', 'also save the supplied mnemonic in the private batch directory')
    .action(opts => generate('derive', opts));
  program.command('import').description('Encrypt an existing Solana CLI keypair without changing its address')
    .addOption(new Option('--chain <chain>', 'import chain').choices(['solana']).makeOptionMandatory())
    .requiredOption('--keypair-file <file>', 'existing 64-byte Solana CLI JSON keypair')
    .requiredOption('--out-dir <dir>', 'new encrypted batch directory')
    .option('--expected-address <address>', 'reject a different public address')
    .option('--keystore-password-file <file>', 'encryption password file')
    .option('--keystore-password-env <name>', 'variable containing encryption password')
    .option('--dry-run', 'show plan without reading or writing secrets')
    .action(importKeypair);
  program.command('pack').description('Package an encrypted EVM or Solana batch')
    .addOption(chainOption())
    .requiredOption('--in-dir <dir>', 'batch directory containing the chain-specific wallet report')
    .option('--out-file <file>', 'new ZIP path; defaults to <batch>.zip')
    .action(pack);
  program.command('verify').description('Verify encrypted wallets or explicitly selected Solana keypairs')
    .addOption(chainOption())
    .addOption(new Option('--format <format>', 'input format').choices(['encrypted', 'solana-keypair']).default('encrypted'))
    .option('--in-dir <dir>', 'keystore directory', './wallets_out/keystore')
    .option('--pattern <glob>', 'file pattern relative to input directory', '*.json')
    .option('--concurrency <n>', 'parallel decryption operations', integer(1, 16), 4)
    .option('--per-file-timeout-ms <n>', 'time budget checked after decryption; 0 disables', integer(0), 30000)
    .option('--max-files <n>', 'maximum files to check; 0 checks all', integer(0), 0)
    .option('--password-file <file>', 'password file; removes one trailing newline')
    .option('--password-env <name>', 'environment variable containing password')
    .option('--write-report', 'write verification_report.json')
    .option('--jsonl', 'write verification.jsonl')
    .action(verify);
  program.command('export').description('Export Solana CLI keypairs from an encrypted Solana batch')
    .addOption(new Option('--chain <chain>', 'export chain').choices(['solana']).makeOptionMandatory())
    .addOption(new Option('--format <format>', 'export format').choices(['solana-keypair']).makeOptionMandatory())
    .requiredOption('--in-dir <dir>', 'encrypted Solana batch directory')
    .requiredOption('--out-dir <dir>', 'new plaintext output directory')
    .option('--allow-plaintext', 'explicitly permit private key output')
    .option('--password-file <file>', 'decryption password file')
    .option('--password-env <name>', 'variable containing decryption password')
    .action(exportKeypairs);
  await program.parseAsync(args, { from: 'user' });
}
function main(args) {
  run(args).catch(err => {
    // Library errors may contain secret inputs. Print only controlled errors from this package.
    const allowed = /^(Unsupported|Plaintext export|Invalid Solana|Output directory|Invalid mnemonic|Derivation indices|Choose only|Keystore password|Mnemonic|Unable to read|Input cancelled|Wallet generation|Generated keystore|Cannot pack|Generation report|Invalid wallet|Keystore path|Duplicate wallet|Keystore directory|Archive inputs|Batch directory|Invalid generation|Invalid keystore|Keystore format|Archive creation)/;
    console.error(allowed.test(err.message) ? err.message : 'Operation failed. Check input files, permissions and that output paths do not already exist.');
    process.exitCode = 1;
  });
}
module.exports = { run, main, integer };
