const fs = require('node:fs/promises');
const path = require('node:path');
const pLimit = require('p-limit');
const evm = require('../chains/evm');
const { readSecret } = require('../shared/secrets');

async function generate(kind, opts) {
  const count = opts.count;
  const start = opts.startIndex;
  if (start + count > 0x80000000) throw new Error('Derivation indices must be below 2147483648.');
  const outDir = path.resolve(opts.outDir);
  if (opts.dryRun) {
    console.log(JSON.stringify({ command: kind, count, startIndex: start, outDir, derivationBase: evm.derivationBase, writesFiles: false }));
    return;
  }
  try { await fs.lstat(outDir); throw new Error('Output directory already exists. Use a new directory for every batch.'); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  const password = await readSecret(opts, 'keystorePassword', 'Keystore password');
  const mnemonic = kind === 'derive' ? await readSecret(opts, 'mnemonic', 'Mnemonic') : evm.generateMnemonic();
  try { evm.derive(mnemonic, start); } catch { throw new Error('Invalid mnemonic or derivation index.'); }
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
    const wallet = evm.derive(mnemonic, index);
    const address = wallet.address.toLowerCase();
    const keystoreFile = `keystore/UTC--${stamp}--${address.slice(2)}.json`;
    const json = await wallet.encrypt(password);
    await fs.writeFile(path.join(outDir, keystoreFile), json, { mode: 0o600, flag: 'wx' });
    // Validate the bytes actually written, for every wallet rather than a sample.
    const recovered = await evm.decrypt(await fs.readFile(path.join(outDir, keystoreFile), 'utf8'), password);
    if (recovered.address !== wallet.address) throw new Error('Generated keystore address mismatch.');
    return { id: index, address, checksumAddress: evm.getAddress(address), derivationPath: `${evm.derivationBase}/${index}`, keystoreFile, timestamp };
  }));
  const settled = await Promise.allSettled(pending);
  if (settled.some(r => r.status === 'rejected')) throw new Error('Wallet generation or verification failed. The incomplete batch was retained; use a new directory to retry.');
  const results = settled.map(r => r.value);
  await fs.writeFile(path.join(outDir, 'generation_report.json'), JSON.stringify({ derivationBase: evm.derivationBase, results }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await fs.unlink(path.join(outDir, 'INCOMPLETE'));
  console.log(`Generated and verified ${results.length} EVM wallet(s): ${outDir}`);
  if (kind === 'generate' || opts.writeMnemonic) console.log('Back up mnemonic.txt separately; it is plaintext and will never be included in the ZIP.');
}
module.exports = { generate };
