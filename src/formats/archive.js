const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const archiver = require('archiver');
const { getChain } = require('../chains');

async function readRegular(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Archive inputs must be regular files, not symlinks.');
  return fs.readFile(file);
}
async function readBatch(opts) {
  const chain = getChain(opts.chain);
  const dir = path.resolve(opts.inDir);
  if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('Batch directory must not be a symlink.');
  try { await fs.lstat(path.join(dir, 'INCOMPLETE')); throw new Error('Cannot pack an incomplete batch.'); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  const reportBytes = await readRegular(path.join(dir, chain.reportName));
  let report;
  try { report = JSON.parse(reportBytes.toString('utf8')); } catch { throw new Error('Invalid generation report JSON.'); }
  if (chain.name === 'solana' && (report?.schemaVersion !== 1 || report.chain !== 'solana' || report.keyFormat !== chain.format || report.derivationPathTemplate !== chain.derivationBase)) throw new Error('Invalid Solana batch manifest.');
  const results = report?.results;
  if (!Array.isArray(results) || !results.length) throw new Error('Generation report must contain wallet entries.');
  const seenIds = new Set(), seenAddresses = new Set(), seenFiles = new Set();
  const files = [];
  const clean = [];
  for (const row of results) {
    if (!Number.isSafeInteger(row.id) || row.id < 0 || typeof row.address !== 'string') throw new Error('Invalid wallet ID or address in report.');
    if (typeof row.keystoreFile !== 'string' || !/^keystore\/[a-zA-Z0-9_.-]+\.json$/.test(row.keystoreFile)) throw new Error('Keystore path must name a JSON file directly inside keystore/.');
    const address = chain.normalizeAddress(row.address);
    if (seenIds.has(row.id) || seenAddresses.has(address) || seenFiles.has(row.keystoreFile)) throw new Error('Duplicate wallet entry in report.');
    seenIds.add(row.id); seenAddresses.add(address); seenFiles.add(row.keystoreFile);
    if ((await fs.lstat(path.join(dir, 'keystore'))).isSymbolicLink()) throw new Error('Keystore directory must not be a symlink.');
    const bytes = await readRegular(path.join(dir, row.keystoreFile));
    let ks;
    try { ks = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid keystore JSON.'); }
    if (chain.name === 'solana') {
      chain.validateKeystore(ks, address);
      if (row.derivationPath !== chain.derivationPath(row.id) || ks.derivationPath !== row.derivationPath) throw new Error('Invalid Solana derivation path in report.');
    } else if (ks.version !== 3 || !(ks.crypto || ks.Crypto) || typeof ks.address !== 'string' || `0x${ks.address.replace(/^0x/, '').toLowerCase()}` !== address) throw new Error('Keystore format or address does not match report.');
    files.push({ bytes, name: row.keystoreFile });
    // Only allow public metadata into the manifest. Never copy arbitrary report fields.
    clean.push({ id: row.id, address, ...(chain.name === 'evm' ? { checksumAddress: chain.getAddress(address) } : {}), derivationPath: row.derivationPath, keystoreFile: row.keystoreFile, timestamp: row.timestamp });
  }
  return { dir, chain, files, report: { ...chain.manifest, results: clean } };
}
async function pack(opts) {
  const { dir, chain, files, report } = await readBatch(opts);
  const basename = path.basename(dir);
  const destination = path.resolve(opts.outFile || `${dir}.zip`);
  const handle = await fs.open(destination, 'wx', 0o600);
  const output = createWriteStream(destination, { fd: handle.fd, autoClose: false });
  const archive = archiver('zip', { zlib: { level: 9 } });
  try {
    await new Promise((resolve, reject) => {
      output.on('finish', resolve); output.on('error', reject);
      archive.on('error', reject); archive.on('warning', reject);
      archive.pipe(output);
      archive.append(JSON.stringify(report, null, 2), { name: `${basename}/${chain.reportName}`, mode: 0o600 });
      for (const file of files) archive.append(file.bytes, { name: `${basename}/${file.name}`, mode: 0o600 });
      archive.finalize().catch(reject);
    });
  } catch (err) {
    archive.abort(); output.destroy();
    throw new Error('Archive creation failed; do not use the partial ZIP.');
  } finally { await handle.close(); }
  console.log(`ZIP created: ${destination} (manifest-listed keystores only; mnemonic excluded)`);
}
module.exports = { pack, readBatch };
