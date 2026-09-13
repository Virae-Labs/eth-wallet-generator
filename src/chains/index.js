const evm = require('./evm');
const solana = require('./solana');
function getChain(name = 'evm') {
  if (name === 'evm') return { ...evm, name, reportName: 'generation_report.json', manifest: { derivationBase: evm.derivationBase }, normalizeAddress: value => evm.getAddress(value).toLowerCase(), derivationPath: index => `${evm.derivationBase}/${index}`, encrypt: (wallet, password) => wallet.encrypt(password) };
  if (name === 'solana') return { ...solana, name, reportName: 'solana_wallet_report.json', manifest: { schemaVersion: 1, chain: 'solana', keyFormat: solana.format, derivationPathTemplate: solana.derivationBase }, normalizeAddress: solana.validateAddress };
  throw new Error('Unsupported chain. Choose evm or solana.');
}
module.exports = { getChain };
