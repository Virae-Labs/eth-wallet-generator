const fs = require('node:fs/promises');
const path = require('node:path');
const pLimit = require('p-limit');
const { getChain } = require('../chains');
const { readSecret } = require('../shared/secrets');

async function generate(kind, opts) {
  const chain = getChain(opts.chain);
  const count = opts.count;
  const start = opts.startIndex;
  if (start + count > 0x80000000) throw new Error('Derivation indices must be below 2147483648.');
  const outDir = path.resolve(opts.outDir);
  if (opts.dryRun) {
    console.log(JSON.stringify({ command: kind, count, startIndex: start, outDir, chain: chain.name, derivationBase: chain.derivationBase, writesFiles: false }));
    return;
  }
  try { await fs.lstat(outDir); throw new Error('Output directory already exists. Use a new directory for every batch.'); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  const password = await readSecret(opts, 'keystorePassword', 'Keystore password');
  const mnemonic = kind === 'derive' ? await readSecret(opts, 'mnemonic', 'Mnemonic') : chain.generateMnemonic();
  try { const sample = await chain.derive(mnemonic, start); if (sample.secretKey) sample.secretKey.fill(0); } catch { throw new Error('Invalid mnemonic or derivation index.'); }
  await fs.mkdir(path.dirname(outDir), { recursive: true });
  await fs.mkdir(outDir, { mode: 0o700 });
  // A partial batch is deliberately retained on failure. Never overwrite or delete wallet material.
  await fs.writeFile(path.join(outDir, 'INCOMPLETE'), 'Generation is incomplete. Do not import this batch.\n', { mode: 0o600, flag: 'wx' });
  if (kind === 'generate' || opts.writeMnemonic) {
    await fs.writeFile(path.join(outDir, 'mnemonic.txt'), `${mnemonic}\n`, { mode: 0o600, flag: 'wx' });
  }
  const keystoreDir = path.join(outDir, 'keystore');
  await fs.mkdir(keystoreDir, { mode: 0o700 });
  const timestamp = new Date().toISOString();
  const stamp = timestamp.replace(/:/g, '-');
  const limit = pLimit(opts.concurrency);
  const pending = Array.from({ length: count }, (_, offset) => limit(async () => {
    const index = start + offset;
    const wallet = await chain.derive(mnemonic, index);
    try {
      const address = chain.normalizeAddress(wallet.address);
      const keystoreFile = chain.name === 'evm' ? `keystore/UTC--${stamp}--${address.slice(2)}.json` : `keystore/${index}--${address}.json`;
      const json = await chain.encrypt(wallet, password, index);
      await fs.writeFile(path.join(outDir, keystoreFile), json, { mode: 0o600, flag: 'wx' });
      // Validate the bytes actually written, for every wallet rather than a sample.
      const recovered = await chain.decrypt(await fs.readFile(path.join(outDir, keystoreFile), 'utf8'), password);
      try {
        if (recovered.address !== wallet.address) throw new Error('Generated keystore address mismatch.');
        if (chain.verifySignature) chain.verifySignature(recovered);
      } finally { if (recovered.secretKey) recovered.secretKey.fill(0); }
      return { id: index, address, ...(chain.name === 'evm' ? { checksumAddress: chain.getAddress(address) } : {}), derivationPath: chain.derivationPath(index), keystoreFile, timestamp };
    } finally { if (wallet.secretKey) wallet.secretKey.fill(0); }
  }));
  const settled = await Promise.allSettled(pending);
  if (settled.some(r => r.status === 'rejected')) throw new Error('Wallet generation or verification failed. The incomplete batch was retained; use a new directory to retry.');
  const results = settled.map(r => r.value);
  await fs.writeFile(path.join(outDir, chain.reportName), JSON.stringify({ ...chain.manifest, results }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await fs.unlink(path.join(outDir, 'INCOMPLETE'));
  console.log(`Generated and verified ${results.length} ${chain.name} wallet(s): ${outDir}`);
  if (kind === 'generate' || opts.writeMnemonic) console.log('Back up mnemonic.txt separately; it is plaintext and will never be included in the ZIP.');
}
module.exports = { generate };
