const bip39 = require('bip39');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default;
const { randomBytes, scrypt, createCipheriv, createDecipheriv } = require('node:crypto');
const { promisify } = require('node:util');
const deriveKey = promisify(scrypt);
const derivationBase = "m/44'/501'/{index}'/0'";
const format = 'solana-keystore';
const kdfparams = { N: 131072, r: 8, p: 1, dklen: 32 };

function validateAddress(address) {
  if (typeof address !== 'string' || bs58.decode(address).length !== 32 || bs58.encode(bs58.decode(address)) !== address) throw new Error('Invalid Solana address.');
  return address;
}
function derivationPath(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 0x80000000) throw new Error('Invalid Solana derivation index.');
  return `m/44'/501'/${index}'/0'`;
}
function fromSecretKey(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 64) throw new Error('Invalid Solana keypair length.');
  const keypair = nacl.sign.keyPair.fromSeed(bytes.subarray(0, 32));
  if (!Buffer.from(keypair.secretKey).equals(Buffer.from(bytes))) throw new Error('Invalid Solana keypair public key.');
  return { address: bs58.encode(keypair.publicKey), secretKey: keypair.secretKey, publicKey: keypair.publicKey };
}
async function derive(mnemonic, index) {
  const { HDKey } = await import('micro-key-producer/slip10.js');
  if (!bip39.validateMnemonic(mnemonic)) throw new Error('Invalid mnemonic.');
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  try {
    const child = HDKey.fromMasterSeed(seed).derive(derivationPath(index));
    try { return fromSecretKey(nacl.sign.keyPair.fromSeed(child.privateKey).secretKey); }
    finally { child.privateKey.fill(0); }
  } finally { seed.fill(0); }
}
function aad(record) {
  return Buffer.from(JSON.stringify([format, record.version, 'solana', record.address, record.derivationPath, ...(record.version === 2 ? [record.keySource] : [])]), 'utf8');
}
function validateKeystore(record, expectedAddress) {
  if (!record || record.format !== format || ![1, 2].includes(record.version) || record.chain !== 'solana') throw new Error('Invalid Solana keystore format.');
  validateAddress(record.address);
  if (expectedAddress !== undefined && record.address !== expectedAddress) throw new Error('Invalid Solana keystore address.');
  const match = typeof record.derivationPath === 'string' && record.derivationPath.match(/^m\/44'\/501'\/(\d+)'\/0'$/);
  if (record.version === 2 ? (record.keySource !== 'imported-keypair' || record.derivationPath !== null) : (!match || derivationPath(Number(match[1])) !== record.derivationPath)) throw new Error('Invalid Solana derivation path.');
  const c = record.crypto;
  if (!c || c.cipher !== 'aes-256-gcm' || c.kdf !== 'scrypt' || !c.kdfparams ||
      Object.entries(kdfparams).some(([key, value]) => c.kdfparams[key] !== value)) throw new Error('Invalid Solana encryption parameters.');
  for (const [key, length] of [['salt', 64], ['iv', 24], ['tag', 32], ['ciphertext', 128]]) {
    if (typeof c[key] !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`).test(c[key])) throw new Error('Invalid Solana encryption encoding.');
  }
  return record;
}
async function encryptionKey(password, salt) {
  if (typeof password !== 'string' || !password.trim()) throw new Error('Keystore password must not be empty.');
  return deriveKey(password, salt, 32, { N: kdfparams.N, r: kdfparams.r, p: kdfparams.p, maxmem: 256 * 1024 * 1024 });
}
async function encrypt(wallet, password, index, imported = false) {
  const salt = randomBytes(32), iv = randomBytes(12);
  const record = { format, version: imported ? 2 : 1, chain: 'solana', address: wallet.address, derivationPath: imported ? null : derivationPath(index), ...(imported ? { keySource: 'imported-keypair' } : {}) };
  const key = await encryptionKey(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(record));
    const ciphertext = Buffer.concat([cipher.update(wallet.secretKey), cipher.final()]);
    record.crypto = { cipher: 'aes-256-gcm', kdf: 'scrypt', kdfparams: { ...kdfparams }, salt: salt.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('hex') };
    return JSON.stringify(record);
  } finally { key.fill(0); }
}
async function decrypt(json, password) {
  const record = validateKeystore(JSON.parse(json));
  const c = record.crypto;
  const key = await encryptionKey(password, Buffer.from(c.salt, 'hex'));
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(c.iv, 'hex'));
    decipher.setAAD(aad(record));
    decipher.setAuthTag(Buffer.from(c.tag, 'hex'));
    plaintext = Buffer.concat([decipher.update(Buffer.from(c.ciphertext, 'hex')), decipher.final()]);
    const wallet = fromSecretKey(plaintext);
    if (wallet.address !== record.address) { wallet.secretKey.fill(0); throw new Error('Invalid Solana keystore address.'); }
    return wallet;
  } finally { key.fill(0); if (plaintext) plaintext.fill(0); }
}
function verifySignature(wallet) {
  const message = Buffer.from('wallet-generator-solana-verification-v1');
  const signature = nacl.sign.detached(message, wallet.secretKey);
  if (!nacl.sign.detached.verify(message, signature, wallet.publicKey)) throw new Error('Invalid Solana signing key.');
}
module.exports = { derivationBase, derivationPath, format, generateMnemonic: () => bip39.generateMnemonic(128), derive, encrypt, encryptImported: (wallet, password) => encrypt(wallet, password, 0, true), decrypt, validateKeystore, validateAddress, fromSecretKey, verifySignature };
