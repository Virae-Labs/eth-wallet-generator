#!/usr/bin/env node
/**
 * wallet-gen-from-mnemonic.js
 *
 * Purpose:
 *  - Use an existing mnemonic (provided via --mnemonic or --mnemonic-file)
 *  - Derive N child wallets from that mnemonic using m/44'/60'/0'/0/i
 *  - Produce keystore JSON files for each derived wallet
 *  - Always write generation_report.json (report EXCLUDES mnemonic)
 *
 * Usage examples:
 *  node wallet-gen-from-mnemonic.js --mnemonic "word1 word2 ... word12" --count 5 --out-dir ./out_existing --keystore-password "StrongPass123"
 *
 *  node wallet-gen-from-mnemonic.js --mnemonic-file ./my-mnemonic.txt --count 3 --out-dir ./out_existing_file --keystore-password "StrongPass123" --write-mnemonic
 *
 * Notes:
 *  - By default this script will NOT write mnemonic.txt (safer). Use --write-mnemonic to force writing.
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
  .name("wallet-gen-from-mnemonic")
  .description("Bulk wallet generator using an existing mnemonic -> keystore files")
  .requiredOption("--mnemonic <phrase>", "existing mnemonic phrase (12/24 words)", undefined)
  .option("--mnemonic-file <file>", "read mnemonic from a file (first non-empty line used)")
  .option("-c, --count <n>", "number of wallets to generate", int10, 1)
  .option("-o, --out-dir <dir>", "output directory", "./wallets_out")
  .option(
    "-m, --modes <list>",
    "comma separated modes: mnemonic-derive,keystore (default both)",
    "mnemonic-derive,keystore"
  )
  .option("--keystore-password <pw>", "password for keystore files (plain text)", "")
  .option("--concurrency <n>", "concurrency for generation", int10, 2)
  .option("--chmod <octal>", "chmod for sensitive files (octal)", int8, 0o600)
  .option("--dry-run", "simulate without writing files", false)
  .option("--write-mnemonic", "also write mnemonic.txt (default false for safety)", false)
  .parse(process.argv);

const opts = program.opts();

(async () => {
  // Resolve mnemonic: priority --mnemonic, then --mnemonic-file if provided
  let rawMnemonic = typeof opts.mnemonic === "string" ? String(opts.mnemonic).trim() : "";
  if ((!rawMnemonic || rawMnemonic.length === 0) && opts.mnemonicFile) {
    try {
      const fileRaw = await fs.readFile(opts.mnemonicFile, "utf8");
      // take first non-empty line
      const first = (fileRaw || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      rawMnemonic = first || "";
    } catch (e) {
      console.error("Failed to read mnemonic file:", e?.message || e);
      process.exit(1);
    }
  }

  if (!rawMnemonic) {
    console.error("Error: no mnemonic provided. Use --mnemonic or --mnemonic-file.");
    process.exit(1);
  }

  // Validate mnemonic by trying to derive index 0
  const derivationBase = "m/44'/60'/0'/0";
  try {
    HDNodeWallet.fromPhrase(rawMnemonic, undefined, `${derivationBase}/0`);
  } catch (e) {
    console.error("Invalid mnemonic phrase:", e?.message || e);
    process.exit(1);
  }

  const count = Math.max(0, opts.count || 1);
  const outDir = path.resolve(opts.outDir || "./wallets_out");
  const modes = (opts.modes || "mnemonic-derive,keystore")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dryRun = !!opts.dryRun;
  const concurrency = Math.max(1, opts.concurrency || 2);
  const chmodMode = opts.chmod || 0o600;
  const keystorePassword = typeof opts.keystorePassword === "string" ? opts.keystorePassword : "";

  // Basic validation of requested modes
  if (!modes.includes("mnemonic-derive") && !modes.includes("mnemonic-generate")) {
    console.error("Error: modes must include mnemonic-derive or mnemonic-generate.");
    process.exit(1);
  }
  if (!modes.includes("keystore")) {
    console.error("Error: keystore mode is required to produce keystore files.");
    process.exit(1);
  }

  if (!keystorePassword) {
    console.warn("Warning: No --keystore-password provided. Keystores will be created with an empty password (NOT recommended).");
  }

  if (!dryRun) await fs.ensureDir(outDir);

  const sharedMnemonic = rawMnemonic;
  const timestampForFiles = new Date().toISOString().replace(/[:]/g, "-");
  const mnemonicWasGenerated = false; // this script never generates

  console.log("Using provided mnemonic (hidden).");
  console.log();

  // Write mnemonic.txt only if --write-mnemonic is true
  if (!dryRun && opts.writeMnemonic) {
    try {
      const mnemonicFile = path.join(outDir, "mnemonic.txt");
      await fs.writeFile(mnemonicFile, `${sharedMnemonic}\n`, { encoding: "utf8", mode: chmodMode });
      try { await fs.chmod(mnemonicFile, chmodMode); } catch (_) {}
      console.log("mnemonic.txt written to outDir (you passed --write-mnemonic).");
    } catch (e) {
      console.warn("Failed to write mnemonic.txt:", e?.message || e);
    }
  }

  // derive wallet for an index using HDNodeWallet.fromPhrase(..., undefined, path)
  function deriveWalletFromSharedMnemonic(idx) {
    const pathForIndex = `${derivationBase}/${idx}`;
    return HDNodeWallet.fromPhrase(sharedMnemonic, undefined, pathForIndex);
  }

  async function generateOne(i) {
    // Add random delay between 100ms and 1000ms
    const randomDelay = Math.floor(Math.random() * 900) + 100;
    await new Promise(resolve => setTimeout(resolve, randomDelay));
    
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