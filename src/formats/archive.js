const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const archiver = require('archiver');
const evm = require('../chains/evm');

async function readRegular(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Archive inputs must be regular files, not symlinks.');
  return fs.readFile(file);
}
async function pack(opts) {
  const dir = path.resolve(opts.inDir);
  if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('Batch directory must not be a symlink.');
  try { await fs.lstat(path.join(dir, 'INCOMPLETE')); throw new Error('Cannot pack an incomplete batch.'); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  const reportBytes = await readRegular(path.join(dir, 'generation_report.json'));
  let report;
  try { report = JSON.parse(reportBytes.toString('utf8')); } catch { throw new Error('Invalid generation report JSON.'); }
  const results = report?.results;
  if (!Array.isArray(results) || !results.length) throw new Error('Generation report must contain wallet entries.');
  const seenIds = new Set(), seenAddresses = new Set(), seenFiles = new Set();
  const files = [];
  const clean = [];
  for (const row of results) {
    if (!Number.isSafeInteger(row.id) || row.id < 0 || typeof row.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(row.address)) throw new Error('Invalid wallet ID or address in report.');
    if (typeof row.keystoreFile !== 'string' || !/^keystore\/[a-zA-Z0-9_.-]+\.json$/.test(row.keystoreFile)) throw new Error('Keystore path must name a JSON file directly inside keystore/.');
    const address = evm.getAddress(row.address).toLowerCase();
    if (seenIds.has(row.id) || seenAddresses.has(address) || seenFiles.has(row.keystoreFile)) throw new Error('Duplicate wallet entry in report.');
    seenIds.add(row.id); seenAddresses.add(address); seenFiles.add(row.keystoreFile);
    if ((await fs.lstat(path.join(dir, 'keystore'))).isSymbolicLink()) throw new Error('Keystore directory must not be a symlink.');
    const bytes = await readRegular(path.join(dir, row.keystoreFile));
    let ks;
    try { ks = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid keystore JSON.'); }
    if (ks.version !== 3 || !(ks.crypto || ks.Crypto) || typeof ks.address !== 'string' || `0x${ks.address.replace(/^0x/, '').toLowerCase()}` !== address) throw new Error('Keystore format or address does not match report.');
    files.push({ bytes, name: row.keystoreFile });
    // Only allow public metadata into the manifest. Never copy arbitrary report fields.
    clean.push({ id: row.id, address, checksumAddress: evm.getAddress(address), derivationPath: row.derivationPath, keystoreFile: row.keystoreFile, timestamp: row.timestamp });
  }
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
      archive.append(JSON.stringify({ derivationBase: evm.derivationBase, results: clean }, null, 2), { name: `${basename}/generation_report.json`, mode: 0o600 });
      for (const file of files) archive.append(file.bytes, { name: `${basename}/${file.name}`, mode: 0o600 });
      archive.finalize().catch(reject);
    });
  } catch (err) {
    archive.abort(); output.destroy();
    throw new Error('Archive creation failed; do not use the partial ZIP.');
  } finally { await handle.close(); }
  console.log(`ZIP created: ${destination} (manifest-listed keystores only; mnemonic excluded)`);
}
module.exports = { pack };
