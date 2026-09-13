const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const bs58 = require('bs58').default;
const solana = require('../src/chains/solana');
const root = path.resolve(__dirname, '..');
// Public BIP39 test phrase; all test keys are disposable.
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const password = 'solana-test-password';
function cli(args, env = {}) {
  return spawnSync(process.execPath, [path.join(root, 'bin/wallet-gen.js'), ...args], { encoding: 'utf8', timeout: 120000, env: { ...process.env, TEST_MNEMONIC: mnemonic, TEST_PASSWORD: password, ...env } });
}
function success(r) { assert.equal(r.status, 0, r.stderr); }
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'solana-wallet-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
function privateObject(seed) {
  return crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed)]), type: 'pkcs8', format: 'der' });
}
// Independent reference: native PBKDF2/HMAC plus OpenSSL Ed25519, not the production HD or signing library.
function reference(index) {
  const seed = crypto.pbkdf2Sync(mnemonic.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512');
  let node = crypto.createHmac('sha512', 'ed25519 seed').update(seed).digest();
  for (const component of [44, 501, index, 0]) {
    const child = Buffer.alloc(4); child.writeUInt32BE(component + 0x80000000);
    node = crypto.createHmac('sha512', node.subarray(32)).update(Buffer.concat([Buffer.from([0]), node.subarray(0, 32), child])).digest();
  }
  return bs58.encode(crypto.createPublicKey(privateObject(node.subarray(0, 32))).export({ type: 'spki', format: 'der' }).subarray(-32));
}

test('Solana hardened derivation matches independent reference and stable address', async () => {
  for (const i of [0, 1, 5, 2147483647]) {
    const wallet = await solana.derive(mnemonic, i);
    assert.equal(wallet.address, reference(i));
    if (i === 0) assert.equal(wallet.address, 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
    assert.equal(wallet.secretKey.length, 64);
    solana.verifySignature(wallet);
  }
  await assert.rejects(solana.derive('not a mnemonic', 0));
  await assert.rejects(solana.derive(mnemonic, 2147483648));
});

test('Solana encrypted format round trip, authentication, KDF bounds and public key consistency', async () => {
  const wallet = await solana.derive(mnemonic, 0);
  const json = await solana.encrypt(wallet, password, 0);
  const recovered = await solana.decrypt(json, password);
  assert.equal(recovered.address, wallet.address);
  assert.deepEqual(recovered.secretKey, wallet.secretKey);
  assert.equal(json.includes(mnemonic), false);
  assert.equal(json.includes(Buffer.from(wallet.secretKey).toString('hex')), false);
  await assert.rejects(solana.decrypt(json, 'wrong'));
  for (const field of ['ciphertext', 'tag', 'iv', 'salt']) {
    const changed = JSON.parse(json); const value = changed.crypto[field];
    changed.crypto[field] = (value[0] === 'a' ? 'b' : 'a') + value.slice(1);
    await assert.rejects(solana.decrypt(JSON.stringify(changed), password));
  }
  const changedAddress = JSON.parse(json); changedAddress.address = (await solana.derive(mnemonic, 1)).address;
  await assert.rejects(solana.decrypt(JSON.stringify(changedAddress), password));
  const changedPath = JSON.parse(json); changedPath.derivationPath = solana.derivationPath(1);
  await assert.rejects(solana.decrypt(JSON.stringify(changedPath), password));
  const oversized = JSON.parse(json); oversized.crypto.kdfparams.N = 1073741824;
  assert.throws(() => solana.validateKeystore(oversized));
  const corrupted = wallet.secretKey.slice(); corrupted[63] ^= 1;
  assert.throws(() => solana.fromSecretKey(corrupted));
});

test('Solana batch CLI, encrypted archive, plaintext export and native signing', async t => {
  const dir = await temp(t), batch = path.join(dir, 'encrypted'), plain = path.join(dir, 'plain');
  const r = cli(['derive', '--chain', 'solana', '--count', '2', '--start-index', '1', '--mnemonic-env', 'TEST_MNEMONIC', '--keystore-password-env', 'TEST_PASSWORD', '--out-dir', batch]);
  success(r); assert.equal(r.stdout.includes(mnemonic), false);
  assert.equal((await fs.readdir(batch)).includes('generation_report.json'), false);
  const report = JSON.parse(await fs.readFile(path.join(batch, 'solana_wallet_report.json')));
  assert.equal(report.schemaVersion, 1); assert.equal(report.chain, 'solana');
  assert.deepEqual(report.results.map(row => row.id), [1, 2]);
  for (const row of report.results) {
    assert.equal(row.address, reference(row.id));
    assert.equal(row.derivationPath, solana.derivationPath(row.id));
    assert.equal(row.checksumAddress, undefined);
  }
  success(cli(['verify', '--chain', 'solana', '--in-dir', path.join(batch, 'keystore'), '--password-env', 'TEST_PASSWORD']));
  assert.notEqual(cli(['verify', '--in-dir', path.join(batch, 'keystore'), '--password-env', 'TEST_PASSWORD']).status, 0);
  await fs.writeFile(path.join(batch, 'mnemonic.txt'), mnemonic);
  success(cli(['pack', '--chain', 'solana', '--in-dir', batch]));
  const zip = spawnSync('python3', ['-c', 'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps(z.namelist()))', batch + '.zip'], { encoding: 'utf8' });
  success(zip);
  assert.deepEqual(JSON.parse(zip.stdout).sort(), ['encrypted/solana_wallet_report.json', ...report.results.map(row => 'encrypted/' + row.keystoreFile)].sort());
  assert.notEqual(cli(['pack', '--in-dir', batch]).status, 0);
  const args = ['export', '--chain', 'solana', '--format', 'solana-keypair', '--in-dir', batch, '--out-dir', plain, '--password-env', 'TEST_PASSWORD'];
  assert.notEqual(cli(args).status, 0);
  assert.notEqual(cli([...args, '--allow-plaintext'], { TEST_PASSWORD: 'wrong' }).status, 0);
  await assert.rejects(fs.stat(plain), { code: 'ENOENT' });
  success(cli([...args, '--allow-plaintext']));
  assert.notEqual(cli([...args, '--allow-plaintext']).status, 0);
  const exported = JSON.parse(await fs.readFile(path.join(plain, 'solana_keypair_report.json')));
  assert.equal(exported.encrypted, false);
  for (const row of exported.results) {
    const file = path.join(plain, row.keypairFile);
    const key = JSON.parse(await fs.readFile(file));
    assert.equal(key.length, 64); assert.ok(key.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
    assert.equal(bs58.encode(Uint8Array.from(key.slice(32))), row.address);
    const signer = privateObject(key.slice(0, 32));
    const message = Buffer.from('independent-solana-export-verification');
    assert.ok(crypto.verify(null, message, crypto.createPublicKey(signer), crypto.sign(null, message, signer)));
    assert.equal(bs58.encode(crypto.createPublicKey(signer).export({ type: 'spki', format: 'der' }).subarray(-32)), row.address);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  }
  success(cli(['verify', '--chain', 'solana', '--format', 'solana-keypair', '--in-dir', path.join(plain, 'keypairs'), '--write-report']));
  success(cli(['verify', '--chain', 'solana', '--format', 'solana-keypair', '--in-dir', path.join(plain, 'keypairs')]));
  assert.notEqual(cli(['pack', '--chain', 'solana', '--in-dir', plain]).status, 0);
  const badKey = path.join(plain, 'keypairs', 'bad.json');
  await fs.writeFile(badKey, JSON.stringify(Array(64).fill(256)));
  assert.notEqual(cli(['verify', '--chain', 'solana', '--format', 'solana-keypair', '--in-dir', path.join(plain, 'keypairs')]).status, 0);
});

test('Solana fresh generation and dry run use correct chain without leaking a mnemonic', async t => {
  const dir = await temp(t), batch = path.join(dir, 'new');
  success(cli(['generate', '--chain', 'solana', '--count', '2', '--out-dir', batch, '--dry-run']));
  assert.deepEqual(await fs.readdir(dir), []);
  const r = cli(['generate', '--chain', 'solana', '--count', '1', '--out-dir', batch, '--keystore-password-env', 'TEST_PASSWORD']);
  success(r);
  const phrase = (await fs.readFile(path.join(batch, 'mnemonic.txt'), 'utf8')).trim();
  assert.equal((r.stdout + r.stderr).includes(phrase), false);
  const report = JSON.parse(await fs.readFile(path.join(batch, 'solana_wallet_report.json')));
  assert.equal((await solana.derive(phrase, 0)).address, report.results[0].address);
  assert.notEqual(cli(['generate', '--chain', 'bitcoin', '--dry-run']).status, 0);
});
