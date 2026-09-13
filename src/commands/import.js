const fs = require('node:fs/promises');
const path = require('node:path');
const { getChain } = require('../chains');
const { readSecret } = require('../shared/secrets');
const { parseKeypair } = require('./verify');

async function importKeypair(opts) {
  if (opts.chain !== 'solana') throw new Error('Unsupported import chain.');
  const chain = getChain('solana');
  const outDir = path.resolve(opts.outDir);
  if (opts.expectedAddress) chain.validateAddress(opts.expectedAddress);
  if (opts.dryRun) { console.log(JSON.stringify({ command: 'import', chain: 'solana', count: 1, outDir, writesFiles: false })); return; }
  try { await fs.lstat(outDir); throw new Error('Output directory already exists.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let wallet;
  try {
    const stat = await fs.lstat(opts.keypairFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error();
    const bytes = await fs.readFile(opts.keypairFile);
    let parsed, secret;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
      secret = parseKeypair(parsed);
      wallet = chain.fromSecretKey(secret);
    } finally { bytes.fill(0); secret?.fill(0); if (Array.isArray(parsed)) parsed.fill(0); }
  } catch { throw new Error('Invalid Solana keypair file. Expected a regular file containing 64 valid keypair bytes.'); }
  try {
    if (opts.expectedAddress && wallet.address !== opts.expectedAddress) throw new Error('Invalid Solana imported address: does not match expected address.');
    const password = await readSecret(opts, 'keystorePassword', 'Keystore password');
    const encrypted = await chain.encryptImported(wallet, password);
    const recovered = await chain.decrypt(encrypted, password);
    try {
      if (recovered.address !== wallet.address) throw new Error('Invalid Solana imported address.');
      chain.verifySignature(recovered);
    } finally { recovered.secretKey.fill(0); }
    await fs.mkdir(path.dirname(outDir), { recursive: true });
    await fs.mkdir(outDir, { mode: 0o700 });
    await fs.writeFile(path.join(outDir, 'INCOMPLETE'), 'Wallet import is incomplete.\n', { mode: 0o600, flag: 'wx' });
    await fs.mkdir(path.join(outDir, 'keystore'), { mode: 0o700 });
    const keystoreFile = `keystore/0--${wallet.address}.json`;
    await fs.writeFile(path.join(outDir, keystoreFile), encrypted + '\n', { mode: 0o600, flag: 'wx' });
    const manifest = { ...chain.manifest, schemaVersion: 2, keySource: 'imported-keypair', derivationPathTemplate: null,
      results: [{ id: 0, address: wallet.address, derivationPath: null, keystoreFile, timestamp: new Date().toISOString() }] };
    await fs.writeFile(path.join(outDir, chain.reportName), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.unlink(path.join(outDir, 'INCOMPLETE'));
    console.log(`Imported and verified 1 Solana wallet: ${wallet.address}. Batch: ${outDir}`);
  } finally { wallet.secretKey.fill(0); }
}
module.exports = { importKeypair };
