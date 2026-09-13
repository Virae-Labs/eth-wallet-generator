const { HDNodeWallet, Wallet, getAddress } = require('ethers');
const derivationBase = "m/44'/60'/0'/0";
module.exports = {
  derivationBase,
  generateMnemonic: () => Wallet.createRandom().mnemonic.phrase,
  derive: (mnemonic, index) => HDNodeWallet.fromPhrase(mnemonic, undefined, `${derivationBase}/${index}`),
  decrypt: (json, password) => Wallet.fromEncryptedJson(json, password),
  getAddress,
};
