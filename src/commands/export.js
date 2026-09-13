const fs = require('node:fs/promises');
const path = require('node:path');
const { readSecret } = require('../shared/secrets');
const { readBatch } = require('../formats/archive');
const { parseKeypair } = require('./verify');

async function exportKeypairs(opts) {
  if (opts.chain !== 'solana' || opts.format !== 'solana-keypair') throw new Error('Unsupported export: choose --chain solana --format solana-keypair.');
  if (!opts.allowPlaintext) throw new Error('Plaintext export requires --allow-plaintext. Files contain private keys.');
  const outDir = path.resolve(opts.outDir);
  try { await fs.lstat(outDir); throw new Error('Output directory already exists.'); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  const { chain, report, files } = await readBatch(opts);
  const password = await readSecret(opts, 'password', 'Keystore password');
  // Validate all encrypted inputs before creating plaintext outputs. Do not retain decrypted batches in memory.
  for (const file of files) {
    const wallet = await chain.decrypt(file.bytes.toString('utf8'), password);
    try { chain.verifySignature(wallet); } finally { wallet.secretKey.fill(0); }
  }
  await fs.mkdir(path.dirname(outDir), { recursive: true });
  await fs.mkdir(outDir, { mode: 0o700 });
  await fs.writeFile(path.join(outDir, 'INCOMPLETE'), 'Plaintext export is incomplete.\n', { flag: 'wx', mode: 0o600 });
  await fs.mkdir(path.join(outDir, 'keypairs'), { mode: 0o700 });
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const row = report.results[i];
    const wallet = await chain.decrypt(files[i].bytes.toString('utf8'), password);
    try {
      const keypairFile = `keypairs/${row.id}--${row.address}.json`;
      const full = path.join(outDir, keypairFile);
      await fs.writeFile(full, JSON.stringify(Array.from(wallet.secretKey)) + '\n', { flag: 'wx', mode: 0o600 });
      const restored = chain.fromSecretKey(parseKeypair(JSON.parse(await fs.readFile(full, 'utf8'))));
      try {
        if (restored.address !== row.address) throw new Error('Invalid Solana exported address.');
        chain.verifySignature(restored);
      } finally { restored.secretKey.fill(0); }
      results.push({ id: row.id, address: row.address, derivationPath: row.derivationPath, keypairFile });
    } finally { wallet.secretKey.fill(0); }
  }
  await fs.writeFile(path.join(outDir, 'solana_keypair_report.json'), JSON.stringify({ ...report, keyFormat: 'solana-keypair', encrypted: false, results }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await fs.unlink(path.join(outDir, 'INCOMPLETE'));
  console.log(`Exported and verified ${results.length} plaintext Solana keypair(s): ${outDir}. These files contain private keys; pack does not package this format.`);
}
module.exports = { exportKeypairs };
