const fs = require('node:fs/promises');
const readline = require('node:readline');

function hiddenInput(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(`${label} required: use a secret file or environment variable in non-interactive mode.`);
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const wasRaw = !!input.isRaw;
    readline.emitKeypressEvents(input);
    process.stdout.write(`${label}: `);
    input.setRawMode(true);
    input.resume();
    let value = '';
    const finish = (error) => {
      input.off('keypress', onKey);
      input.setRawMode(wasRaw);
      input.pause();
      process.stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('Input cancelled.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') value = Array.from(value).slice(0, -1).join('');
      else if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    };
    input.on('keypress', onKey);
  });
}

async function readSecret(options, name, label) {
  const choices = [`${name}File`, `${name}Env`].filter(key => options[key] !== undefined);
  if (choices.length > 1) throw new Error(`Choose only one ${name} input source.`);
  let value;
  if (options[`${name}File`] !== undefined) {
    try { value = (await fs.readFile(options[`${name}File`], 'utf8')).replace(/\r?\n$/, ''); }
    catch { throw new Error(`Unable to read ${name} file.`); }
  } else if (options[`${name}Env`] !== undefined) value = process.env[options[`${name}Env`]];
  else value = await hiddenInput(label);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must not be empty.`);
  return name === 'mnemonic' ? value.trim().replace(/\s+/g, ' ') : value;
}
module.exports = { readSecret };
