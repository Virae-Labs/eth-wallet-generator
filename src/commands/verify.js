const fs = require('node:fs/promises');
const path = require('node:path');
const fg = require('fast-glob');
const pLimit = require('p-limit');
const evm = require('../chains/evm');
const { readSecret } = require('../shared/secrets');

async function verify(opts) {
  const password = await readSecret(opts, 'password', 'Keystore password');
  const inDir = path.resolve(opts.inDir);
  if (!(await fs.stat(inDir)).isDirectory()) throw new Error('Input directory must be a directory.');
  const entries = (await fg(opts.pattern, { cwd: inDir, onlyFiles: true, dot: false, absolute: true, followSymbolicLinks: false })).sort();
  const files = opts.maxFiles > 0 ? entries.slice(0, opts.maxFiles) : entries;
  if (!files.length) {
    console.error('No keystore files matched.');
    process.exitCode = 2;
    return;
  }
  const limit = pLimit(opts.concurrency);
  const results = await Promise.all(files.map(file => limit(async () => {
    const result = { file: path.relative(inDir, file), absolutePath: file, ok: false, reason: null, decryptedAddress: null, keystoreAddress: null, matchesKeystoreAddress: null, timestamp: new Date().toISOString() };
    try {
      const raw = await fs.readFile(file, 'utf8');
      const data = JSON.parse(raw);
      if (typeof data.address === 'string' && data.address) result.keystoreAddress = '0x' + data.address.toLowerCase().replace(/^0x/, '');
      const started = Date.now();
      // Do not release a concurrency slot before the non-cancellable KDF has finished.
      const wallet = await evm.decrypt(raw, password);
      if (opts.perFileTimeoutMs > 0 && Date.now() - started > opts.perFileTimeoutMs) {
        result.reason = 'Verification exceeded the per-file time budget.';
        return result;
      }
      result.decryptedAddress = wallet.address.toLowerCase();
      result.ok = true;
      if (result.keystoreAddress) {
        result.matchesKeystoreAddress = result.decryptedAddress === result.keystoreAddress;
        if (!result.matchesKeystoreAddress) result.reason = 'Decrypted address does not match keystore address.';
      }
    } catch {
      result.reason = 'Keystore read, decryption or validation failed.';
    }
    return result;
  })));
  const success = results.filter(r => r.ok && r.matchesKeystoreAddress !== false).length;
  const addressMismatch = results.filter(r => r.ok && r.matchesKeystoreAddress === false).length;
  const failed = results.length - success - addressMismatch;
  for (const r of results) console.log(`[${r.ok && r.matchesKeystoreAddress !== false ? 'OK' : 'FAIL'}] ${r.file}`);
  console.log(`Total: ${results.length}; Success: ${success}; Addr mismatch: ${addressMismatch}; Failed: ${failed}`);
  const reportDir = path.basename(inDir).toLowerCase() === 'keystore' ? path.dirname(inDir) : inDir;
  if (opts.writeReport) {
    await fs.writeFile(path.join(reportDir, 'verification_report.json'), JSON.stringify({ inputDir: inDir, pattern: opts.pattern, concurrency: opts.concurrency, perFileTimeoutMs: opts.perFileTimeoutMs, total: results.length, success, addressMismatch, failed, results, generatedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  }
  if (opts.jsonl) await fs.writeFile(path.join(reportDir, 'verification.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
  if (failed || addressMismatch) process.exitCode = 2;
}
module.exports = { verify };
