const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Wallet, verifyMessage } = require('ethers');
const evm = require('../src/chains/evm');
const { readSecret } = require('../src/shared/secrets');
const root = path.resolve(__dirname, '..');
// Public Hardhat test mnemonic. Never use these accounts for real assets.
const mnemonic = 'test test test test test test test test test test test junk';
const password = 'test-only-password';
function cli(args, env = {}) {
  return spawnSync(process.execPath, [path.join(root, 'bin/wallet-gen.js'), ...args], {
    encoding: 'utf8', env: { ...process.env, TEST_MNEMONIC: mnemonic, TEST_PASSWORD: password, ...env }, timeout: 120000,
  });
}
function success(r) { assert.equal(r.status, 0, r.stderr); }
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'evm-generator-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('existing EVM derivation addresses and message signatures are unchanged', async () => {
  const expected = ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'];
  for (let i = 0; i < expected.length; i++) {
    const wallet = evm.derive(mnemonic, i);
    assert.equal(wallet.address, expected[i]);
    assert.equal(verifyMessage('wallet-generator-test', await wallet.signMessage('wallet-generator-test')), expected[i]);
  }
});

test('strict counts and plan-only dry run', async t => {
  const dir = await temp(t);
  for (const count of ['0', '-1', '1.5', '2abc']) assert.notEqual(cli(['generate', '--count', count, '--dry-run']).status, 0);
  const r = cli(['generate', '--count', '3', '--out-dir', path.join(dir, 'unused'), '--dry-run']);
  success(r); assert.equal(r.stdout.includes(mnemonic), false);
  assert.deepEqual(await fs.readdir(dir), []);

});

test('secret files preserve password whitespace and reject conflicting inputs', async t => {
  const dir = await temp(t), file = path.join(dir, 'pw');
  await fs.writeFile(file, '  spaced password  \n');
  assert.equal(await readSecret({ passwordFile: file }, 'password', 'Password'), '  spaced password  ');
  await assert.rejects(readSecret({ passwordEnv: 'TEST_PASSWORD', passwordFile: file }, 'password', 'Password'), /only one/);
});

test('mnemonic-file generation, backend manifest, archive and verification round trip', async t => {
  const dir = await temp(t), batch = path.join(dir, 'recovered'), phraseFile = path.join(dir, 'phrase');
  await fs.writeFile(phraseFile, mnemonic + '\n', { mode: 0o600 });
  const r = cli(['derive', '--mnemonic-file', phraseFile, '--count', '2', '--start-index', '1', '--out-dir', batch, '--keystore-password-env', 'TEST_PASSWORD']);
  success(r); assert.equal(r.stdout.includes(mnemonic), false);
  const report = JSON.parse(await fs.readFile(path.join(batch, 'generation_report.json')));
  assert.deepEqual(report.results.map(r => r.id), [1, 2]);
  for (const row of report.results) {
    // These are the fields and relative paths consumed by trading-bot/src/wallet/upload.ts.
    assert.equal(typeof row.id, 'number'); assert.equal(typeof row.address, 'string');
    const file = path.join(batch, row.keystoreFile);
    const wallet = await Wallet.fromEncryptedJson(await fs.readFile(file, 'utf8'), password);
    assert.equal(wallet.address, evm.derive(mnemonic, row.id).address);
    assert.equal(row.derivationPath, `${evm.derivationBase}/${row.id}`);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  }
  assert.equal((await fs.stat(batch)).mode & 0o777, 0o700);
  const reportBefore = await fs.readFile(path.join(batch, 'generation_report.json'), 'utf8');
  assert.notEqual(cli(['generate', '--out-dir', batch, '--keystore-password-env', 'TEST_PASSWORD']).status, 0);
  assert.equal(await fs.readFile(path.join(batch, 'generation_report.json'), 'utf8'), reportBefore);
  success(cli(['verify', '--in-dir', path.join(batch, 'keystore'), '--password-env', 'TEST_PASSWORD', '--write-report']));
  assert.notEqual(cli(['verify', '--in-dir', path.join(batch, 'keystore'), '--password-env', 'WRONG_PASSWORD'], { WRONG_PASSWORD: 'wrong' }).status, 0);
  await fs.writeFile(path.join(batch, 'mnemonic.txt'), mnemonic);
  await fs.writeFile(path.join(batch, 'keystore', 'unlisted.json'), '{"privateKey":"must-not-be-packed"}');
  success(cli(['pack', '--in-dir', batch]));
  const zip = batch + '.zip';
  const inspected = spawnSync('python3', ['-c', 'import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({"names":z.namelist(),"report":json.loads(z.read("recovered/generation_report.json"))}))', zip], { encoding: 'utf8' });
  success(inspected);
  const archive = JSON.parse(inspected.stdout);
  assert.deepEqual(archive.report, report);
  assert.deepEqual(archive.names.sort(), ['recovered/generation_report.json', ...report.results.map(row => `recovered/${row.keystoreFile}`)].sort());
  assert.equal((await fs.stat(zip)).mode & 0o777, 0o600);
  assert.notEqual(cli(['pack', '--in-dir', batch]).status, 0);
  await fs.writeFile(path.join(batch, 'INCOMPLETE'), 'unfinished');
  assert.notEqual(cli(['pack', '--in-dir', batch, '--out-file', path.join(dir, 'incomplete.zip')]).status, 0);
});

test('new mnemonic backup is recoverable and never logged', async t => {
  const dir = await temp(t), batch = path.join(dir, 'new');
  const r = cli(['generate', '--count', '1', '--out-dir', batch, '--keystore-password-env', 'TEST_PASSWORD']);
  success(r);
  const phrase = (await fs.readFile(path.join(batch, 'mnemonic.txt'), 'utf8')).trim();
  assert.equal(r.stdout.includes(phrase), false);
  const report = JSON.parse(await fs.readFile(path.join(batch, 'generation_report.json')));
  assert.equal(evm.derive(phrase, 0).address.toLowerCase(), report.results[0].address);
  assert.equal((await fs.stat(path.join(batch, 'mnemonic.txt'))).mode & 0o777, 0o600);
});

test('standard V3 wallet without HD metadata is supported', async t => {
  const dir = await temp(t);
  const wallet = new Wallet(evm.derive(mnemonic, 0).privateKey);
  const file = path.join(dir, 'standard.json');
  const keystore = JSON.parse(await wallet.encrypt(password));
  keystore.crypto = keystore.Crypto;
  delete keystore.Crypto;
  await fs.writeFile(file, JSON.stringify(keystore));
  success(cli(['verify', '--in-dir', dir, '--password-env', 'TEST_PASSWORD']));
  await fs.mkdir(path.join(dir, 'keystore'));
  await fs.rename(file, path.join(dir, 'keystore', 'standard.json'));
  await fs.writeFile(path.join(dir, 'generation_report.json'), JSON.stringify({ results: [{ id: 0, address: wallet.address.toLowerCase(), keystoreFile: 'keystore/standard.json' }] }));
  success(cli(['pack', '--in-dir', dir, '--out-file', path.join(dir, 'standard.zip')]));
});

test('pack rejects path traversal and verify fails for an empty directory', async t => {
  const dir = await temp(t);
  assert.equal(cli(['verify', '--in-dir', dir, '--password-env', 'TEST_PASSWORD']).status, 2);
  await fs.writeFile(path.join(dir, 'generation_report.json'), JSON.stringify({ results: [{ id: 0, address: evm.derive(mnemonic, 0).address, keystoreFile: '../secret.json' }] }));
  assert.notEqual(cli(['pack', '--in-dir', dir]).status, 0);
});

test('empty passwords and invalid mnemonics fail without creating a batch or exposing inputs', async t => {
  const dir = await temp(t), batch = path.join(dir, 'invalid');
  const empty = cli(['generate', '--out-dir', batch, '--keystore-password-env', 'EMPTY_PASSWORD'], { EMPTY_PASSWORD: '' });
  assert.notEqual(empty.status, 0);
  const invalid = 'invalid-private-input-do-not-print';
  const r = cli(['derive', '--mnemonic-env', 'INVALID_MNEMONIC', '--keystore-password-env', 'TEST_PASSWORD', '--out-dir', batch], { INVALID_MNEMONIC: invalid });
  assert.notEqual(r.status, 0); assert.equal((r.stdout + r.stderr).includes(invalid), false);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('archive rejects symlinked keys and duplicate wallet records', async t => {
  const dir = await temp(t), batch = path.join(dir, 'batch');
  await fs.mkdir(path.join(batch, 'keystore'), { recursive: true });
  const wallet = evm.derive(mnemonic, 0);
  const row = { id: 0, address: wallet.address, keystoreFile: 'keystore/wallet.json' };
  await fs.writeFile(path.join(batch, 'generation_report.json'), JSON.stringify({ results: [row] }));
  const external = path.join(dir, 'external.json');
  await fs.writeFile(external, '{}');
  await fs.symlink(external, path.join(batch, row.keystoreFile));
  assert.notEqual(cli(['pack', '--in-dir', batch]).status, 0);
  await fs.unlink(path.join(batch, row.keystoreFile));
  await fs.writeFile(path.join(batch, row.keystoreFile), JSON.stringify({ version: 3, address: wallet.address.slice(2), crypto: {} }));
  await fs.writeFile(path.join(batch, 'generation_report.json'), JSON.stringify({ results: [row, row] }));
  assert.notEqual(cli(['pack', '--in-dir', batch]).status, 0);
});

test('only the new commands and manifest format are accepted', async t => {
  for (const flag of ['--modes', '--chmod', '--keystore-password']) {
    assert.notEqual(cli(['generate', flag, 'unused', '--dry-run']).status, 0);
  }
  const dir = await temp(t);
  await fs.writeFile(path.join(dir, 'generation_report.json'), '[]');
  assert.notEqual(cli(['pack', '--in-dir', dir]).status, 0);
});
