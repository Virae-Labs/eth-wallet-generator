const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const nacl = require('tweetnacl');
const chain = require('../src/chains/solana');
const { readBatch } = require('../src/formats/archive');
const root = path.resolve(__dirname, '..');
function cli(args) {
  return spawnSync(process.execPath, ['bin/wallet-gen.js', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, IMPORT_TEST_PASSWORD: 'public-import-test' } });
}
test('existing keypair survives encrypted import, pack, verify and explicit export', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wallet-import-'));
  const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(17));
  const wallet = chain.fromSecretKey(pair.secretKey);
  const input = path.join(dir, 'input.json'), out = path.join(dir, 'batch');
  await fs.writeFile(input, JSON.stringify([...pair.secretKey]));
  const args = ['import','--chain','solana','--keypair-file',input,'--out-dir',out,'--expected-address',wallet.address,'--keystore-password-env','IMPORT_TEST_PASSWORD'];
  try {
    assert.equal(cli([...args,'--dry-run']).status,0);
    await assert.rejects(fs.stat(out));
    let result=cli(args); assert.equal(result.status,0,result.stderr);
    assert.equal(cli(args).status,1,'Never overwrite an existing batch');
    const batch=await readBatch({chain:'solana',inDir:out});
    assert.equal(batch.report.schemaVersion,2); assert.equal(batch.report.derivationPathTemplate,null);
    assert.equal(batch.report.results[0].address,wallet.address);
    assert.equal(batch.report.results[0].derivationPath,null);
    await assert.rejects(fs.stat(path.join(out,'mnemonic.txt')));
    assert.equal((await fs.stat(out)).mode & 0o777,0o700);
    assert.equal((await fs.stat(path.join(out,batch.report.results[0].keystoreFile))).mode & 0o777,0o600);
    const key=JSON.parse(batch.files[0].bytes);
    await assert.rejects(chain.decrypt(JSON.stringify(key),'wrong'));
    assert.throws(()=>chain.validateKeystore({...key,keySource:'mnemonic'}));
    assert.throws(()=>chain.validateKeystore({...key,derivationPath:"m/44'/501'/0'/0'"}));
    await assert.rejects(chain.decrypt(JSON.stringify({...key,version:1,derivationPath:"m/44'/501'/0'/0'"}),'public-import-test'));
    result=cli(['verify','--chain','solana','--in-dir',path.join(out,'keystore'),'--password-env','IMPORT_TEST_PASSWORD']); assert.equal(result.status,0,result.stderr);
    result=cli(['pack','--chain','solana','--in-dir',out]); assert.equal(result.status,0,result.stderr);
    const zip=spawnSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert len(z.namelist())==2; assert all("mnemonic" not in n and "input.json" not in n for n in z.namelist())',out+'.zip']); assert.equal(zip.status,0);
    result=cli(['export','--chain','solana','--format','solana-keypair','--in-dir',out,'--out-dir',path.join(dir,'plain'),'--password-env','IMPORT_TEST_PASSWORD','--allow-plaintext']); assert.equal(result.status,0,result.stderr);
    const restored=JSON.parse(await fs.readFile(path.join(dir,'plain','keypairs',`0--${wallet.address}.json`),'utf8'));
    assert.deepEqual(restored,[...pair.secretKey]);
    const exportReport=JSON.parse(await fs.readFile(path.join(dir,'plain','solana_keypair_report.json'),'utf8'));
    assert.equal(exportReport.derivationPathTemplate,null); assert.equal(exportReport.keySource,'imported-keypair');
    const mismatch=cli(['import','--chain','solana','--keypair-file',input,'--out-dir',path.join(dir,'wrong'),'--expected-address','11111111111111111111111111111111','--keystore-password-env','IMPORT_TEST_PASSWORD']); assert.equal(mismatch.status,1); await assert.rejects(fs.stat(path.join(dir,'wrong')));
    await fs.writeFile(input,JSON.stringify(Array(64).fill(0)));
    result=cli(['import','--chain','solana','--keypair-file',input,'--out-dir',path.join(dir,'invalid'),'--keystore-password-env','IMPORT_TEST_PASSWORD']); assert.equal(result.status,1); await assert.rejects(fs.stat(path.join(dir,'invalid')));
  } finally { wallet.secretKey.fill(0); pair.secretKey.fill(0); await fs.rm(dir,{recursive:true,force:true}); }
});
