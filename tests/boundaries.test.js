const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { integer } = require('../src/cli');
const { getChain } = require('../src/chains');
const { readSecret } = require('../src/shared/secrets');

test('integer parser rejects exponent, unsafe and out-of-range values', () => {
  for (const value of ['1e3','-1','1.1','NaN','9007199254740992','17']) assert.throws(() => integer(1,16)(value));
  assert.equal(integer(1,16)('16'),16); assert.equal(integer(0)('0'),0);
});
test('chain registry keeps Solana case and rejects unsupported chains', () => {
  assert.equal(getChain().name,'evm'); assert.throws(() => getChain('bitcoin'));
  const address='So11111111111111111111111111111111111111112';
  assert.equal(getChain('solana').normalizeAddress(address),address);
});
test('missing secret files and variables fail without exposing their contents', async () => {
  await assert.rejects(readSecret({passwordFile:'/nonexistent-fixture-password'},'password','Password'), /Unable to read password file/);
  await assert.rejects(readSecret({passwordEnv:'NONEXISTENT_WALLET_FIXTURE_VAR'},'password','Password'), /must not be empty/);
  await assert.rejects(readSecret({passwordFile:'unused',passwordEnv:'unused'},'password','Password'), /Choose only one/);
});
test('dry-run lifecycle diagnostics contain no input paths or secrets', () => {
  const r=spawnSync(process.execPath,['bin/wallet-gen.js','derive','--dry-run','--mnemonic-file','sensitive-file-path','--keystore-password-env','SENSITIVE_VAR'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const events=r.stderr.trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(events.map(e=>e.event),['wallet_command_started','wallet_command_completed']);
  assert.equal(events[1].dryRun,true); assert.ok(!r.stderr.includes('sensitive-file-path')); assert.ok(!r.stderr.includes('SENSITIVE_VAR'));
});

test('verification failure is not logged as a successful command completion', async t => {
  const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wallet-diagnostics-test-'));
  t.after(() => fs.rm(dir, {recursive:true,force:true}));
  const r=spawnSync(process.execPath,['bin/wallet-gen.js','verify','--chain','solana','--format','solana-keypair','--in-dir',dir],{encoding:'utf8'});
  assert.equal(r.status,2);
  const events=r.stderr.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
  assert.equal(events.at(-1).event,'wallet_command_failed'); assert.equal(events.at(-1).exitCode,2);
  assert.ok(!r.stderr.includes('wallet_command_completed'));
});
