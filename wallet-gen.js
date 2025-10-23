#!/usr/bin/env node
/**
 * wallet-gen.js (minimal, fixed, no --no-summary-files, no mnemonic in report)
 *
 * Purpose:
 *  - Generate a single shared 12-word mnemonic (ethers Wallet.createRandom())
 *  - Derive N child wallets from that mnemonic using m/44'/60'/0'/0/i
 *  - Produce keystore JSON files for each derived wallet
 *  - Always write mnemonic.txt and generation_report.json (report excludes mnemonic)
 *
 * Usage example:
 *  node wallet-gen.js --count 2 --out-dir ./out_mnemonic_keystore_only \
 *    --modes mnemonic-generate,keystore --keystore-password "StrongPass123"
 */

const { Command } = require("commander");
const { Wallet, getAddress, HDNodeWallet } = require("ethers");
const fs = require("fs-extra");
const path = require("path");
const pLimit = require("p-limit");

// Safe integer parser (base 10)
const int10 = (v) => {
  const n = Number.parseInt(String(v), 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer: ${v}`);
  return n;
};
// Safe octal parser for chmod
const int8 = (v) => {
  const n = Number.parseInt(String(v), 8);
  if (Number.isNaN(n)) throw new Error(`Invalid octal: ${v}`);
  return n;
};

const program = new Command();

program
  .name("wallet-gen")
  .description("Minimal bulk wallet generator: shared mnemonic -> keystore files")
  .option("-c, --count <n>", "number of wallets to generate", int10, 1)
  .option("-o, --out-dir <dir>", "output directory", "./wallets_out")
  .option(
    "-m, --modes <list>",
    "comma separated modes: mnemonic-generate,keystore (default both)",
    "mnemonic-generate,keystore"
  )
  .option("--keystore-password <pw>", "password for keystore files (plain text)", "")
  .option("--concurrency <n>", "concurrency for generation", int10, 2)
  .option("--chmod <octal>", "chmod for sensitive files (octal)", int8, 0o600)
  .option("--dry-run", "simulate without writing files", false)
  .parse(process.argv);

const opts = program.opts();

(async () => {
  const count = Math.max(0, opts.count || 1);
  const outDir = path.resolve(opts.outDir || "./wallets_out");
  const modes = (opts.modes || "mnemonic-generate,keystore")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dryRun = !!opts.dryRun;
  const concurrency = Math.max(1, opts.concurrency || 2);
  const chmodMode = opts.chmod || 0o600;
  const keystorePassword = typeof opts.keystorePassword === "string" ? opts.keystorePassword : "";

  // Basic validation of requested modes
  if (!modes.includes("mnemonic-generate") && !modes.includes("mnemonic-derive")) {
    console.error("Error: This minimal script supports mnemonic-generate (shared mnemonic) as primary flow.");
    process.exit(1);
  }
  if (!modes.includes("keystore")) {
    console.error("Error: This minimal script expects 'keystore' mode to produce keystore files.");
    process.exit(1);
  }

  if (!keystorePassword) {
    console.warn("Warning: No --keystore-password provided. Keystores will be created with an empty password (NOT recommended).");
  }

  if (!dryRun) await fs.ensureDir(outDir);

  // Create shared mnemonic (12 words via ethers Wallet.createRandom())
  const random = Wallet.createRandom();
  if (!random?.mnemonic?.phrase) {
    console.error("Failed to generate mnemonic. Aborting.");
    process.exit(1);
  }
  const sharedMnemonic = random.mnemonic.phrase;
  const derivationBase = "m/44'/60'/0'/0"; // fixed base path
  const timestampForFiles = new Date().toISOString().replace(/[:]/g, "-");

  console.log("Shared mnemonic (12 words):");
  console.log(sharedMnemonic);
  console.log();

  // Always write mnemonic.txt (unless dry-run)
  if (!dryRun) {
    try {
      const mnemonicFile = path.join(outDir, "mnemonic.txt");
      await fs.writeFile(mnemonicFile, `${sharedMnemonic}\n`, { encoding: "utf8", mode: chmodMode });
      try { await fs.chmod(mnemonicFile, chmodMode); } catch (_) {}
    } catch (e) {
      console.warn("Failed to write mnemonic.txt:", e?.message || e);
    }
  }

  // Derive wallet for an index using HDNodeWallet.fromPhrase(..., undefined, path)
  function deriveWalletFromSharedMnemonic(idx) {
    const pathForIndex = `${derivationBase}/${idx}`;
    // IMPORTANT: second arg is password (unused), third arg is the path to return
    return HDNodeWallet.fromPhrase(sharedMnemonic, undefined, pathForIndex);
  }

  async function generateOne(i) {
    const ts = new Date().toISOString();
    const out = {
      id: i,
      address: null,
      checksumAddress: null,
      derivationPath: `${derivationBase}/${i}`,
      keystoreFile: null,
      timestamp: ts,
    };

    // derive wallet for this index
    const wallet = deriveWalletFromSharedMnemonic(i);
    out.address = wallet.address.toLowerCase();
    out.checksumAddress = getAddress(out.address);

    // create keystore JSON
    const keystoreJson = await wallet.encrypt(keystorePassword);

    const filename = `UTC--${timestampForFiles}--${out.address.replace(/^0x/, "")}.json`;
    const keystoreDir = path.join(outDir, "keystore");
    if (!dryRun) {
      await fs.ensureDir(keystoreDir);
      const full = path.join(keystoreDir, filename);
      await fs.writeFile(full, keystoreJson, { encoding: "utf8", mode: chmodMode });
      try { await fs.chmod(full, chmodMode); } catch (_) {}
      out.keystoreFile = path.relative(outDir, full);
    } else {
      out.keystoreFile = path.join("keystore", filename);
    }

    return out;
  }

  // run generation with concurrency
  const limit = pLimit(concurrency);
  const tasks = Array.from({ length: count }, (_, i) => limit(() => generateOne(i)));

  let results;
  try {
    results = await Promise.all(tasks);
  } catch (err) {
    console.error("Generation error:", err);
    process.exit(1);
  }

  // Always write generation_report.json (EXCLUDES MNEMONIC)
  if (!dryRun) {
    const reportPath = path.join(outDir, "generation_report.json");
    try {
      await fs.writeJson(reportPath, { derivationBase, results }, { spaces: 2 });
      try { await fs.chmod(reportPath, chmodMode); } catch (_) {}
    } catch (e) {
      console.warn("Failed to write generation_report.json:", e?.message || e);
    }
  }

  // Basic validation: attempt to decrypt the first keystore (if exists) to check password
  if (!dryRun && results.length > 0) {
    try {
      const sample = results[0];
      const full = path.join(outDir, sample.keystoreFile);
      const ks = await fs.readFile(full, "utf8");
      const w = await Wallet.fromEncryptedJson(ks, keystorePassword);
      if (w.address.toLowerCase() !== sample.address.toLowerCase()) {
        console.warn("Validation failed: decrypted address mismatch for sample keystore.");
      } else {
        console.log("Sample keystore validated successfully (password is correct for sample).");
      }
    } catch (e) {
      console.warn("Validation warning (couldn't decrypt sample keystore):", e?.message || e);
    }
  }

  console.log(`Done. Generated ${results.length} keystore(s) in ${dryRun ? "[dry-run]" : outDir}`);
})();