#!/usr/bin/env node
/**
 * wallet-gen.js (fixed)
 *
 * Fix: custom number parsers so Commander does not pass "previous" as radix to parseInt.
 * - int10: parse base-10 integers safely
 * - int8 : parse base-8 integers (for chmod)
 *
 * Features:
 *  - Modes: hex, keystore, mnemonic-generate (one shared mnemonic), mnemonic-derive (provided mnemonic)
 *  - CSV + TXT output, optional keystore JSON files
 *  - Optional inclusion of private keys/mnemonic in CSV/TXT with --include-private (dangerous)
 *  - Validation, concurrency, chmod, optional zip
 */

const { Command } = require("commander");
const { Wallet, getAddress } = require("ethers");
const fs = require("fs-extra");
const path = require("path");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const pLimit = require("p-limit"); // v3 (CommonJS)
const archiver = require("archiver");

/** Safe integer parsers for Commander */
const int10 = (v) => {
  const n = Number.parseInt(String(v), 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer: ${v}`);
  return n;
};
const int8 = (v) => {
  const n = Number.parseInt(String(v), 8);
  if (Number.isNaN(n)) throw new Error(`Invalid octal: ${v}`);
  return n;
};

const program = new Command();

program
  .name("wallet-gen")
  .description("Bulk Ethereum wallet generator")
  .option("-c, --count <n>", "number of wallets to generate", int10, 1)
  .option("-o, --out-dir <dir>", "output directory", "./wallets_out")
  .option(
    "-m, --modes <list>",
    "comma separated: hex,keystore,mnemonic-generate,mnemonic-derive",
    "hex"
  )
  .option("--keystore-password <pw>", "password for keystore files (discouraged to pass in plain)")
  .option("--keystore-password-file <file>", "file with passwords (one per line), reused in round-robin")
  .option("--mnemonic <mnemonic>", "BIP39 mnemonic (for mnemonic-derive mode)")
  .option("--mnemonic-words <12|24>", "words for mnemonic-generate (default 12)", "12")
  .option("--mnemonic-start-index <idx>", "start index for derivation", int10, 0)
  .option(
    "--derivation-path <path>",
    "base derivation path WITHOUT /i (default: m/44'/60'/0'/0)",
    "m/44'/60'/0'/0"
  )
  .option("--include-private", "include private key and mnemonic in CSV/TXT (DANGEROUS)", false)
  .option("--csv-file <file>", "CSV filename (default: <out-dir>/wallets.csv)", "")
  .option("--txt-file <file>", "TXT filename (default: <out-dir>/wallets.txt)", "")
  // Commander supports negation: passing --no-summary-files will set opts.summaryFiles=false
  .option("--summary-files", "write CSV/TXT summary files", true)
  .option("--no-summary-files", "do not write CSV/TXT summary files")
  .option("--concurrency <n>", "concurrency for generation (default 2)", int10, 2)
  .option("--validate-aftergen", "validate generated items (default off)", false)
  .option("--chmod <octal>", "chmod for sensitive files (default 600)", int8, 0o600)
  .option("--zip-output", "zip the entire output directory (no strong encryption)", false)
  .option("--zip-password <pw>", "zip password hint (NOT strong; see notes)", "")
  .option("--dry-run", "simulate without writing files", false)
  .parse(process.argv);

const opts = program.opts();

(async () => {
  const count = Math.max(0, opts.count || 1);
  const outDir = path.resolve(opts.outDir || "./wallets_out");
  const modes = (opts.modes || "hex").split(",").map((s) => s.trim()).filter(Boolean);
  const includePrivate = !!opts.includePrivate;
  // Default to true; allow either --summary-files or --no-summary-files to override
  let summaryFiles = typeof opts.summaryFiles === "boolean" ? opts.summaryFiles : true;
  if (typeof opts.noSummaryFiles === "boolean" && opts.noSummaryFiles) summaryFiles = false;
  const concurrency = Math.max(1, opts.concurrency || 2);
  const csvPath = opts.csvFile ? path.resolve(opts.csvFile) : path.join(outDir, "wallets.csv");
  const txtPath = opts.txtFile ? path.resolve(opts.txtFile) : path.join(outDir, "wallets.txt");
  const mnemonicWords = Number(opts.mnemonicWords) === 24 ? 24 : 12;
  const derivationPathBase = (opts.derivationPath || "m/44'/60'/0'/0").replace(/\/$/, "");
  const startIndex = Math.max(0, opts.mnemonicStartIndex || 0);
  const chmodMode = opts.chmod || 0o600;
  const dryRun = !!opts.dryRun;
  const validateAfter = !!opts.validateAftergen;

  if (modes.includes("keystore") && !opts.keystorePassword && !opts.keystorePasswordFile) {
    console.warn(
      "Warning: keystore mode selected but no --keystore-password or --keystore-password-file.\n" +
      "An empty password will be used (NOT recommended)."
    );
  }
  if (includePrivate) {
    console.warn(
      "DANGER: --include-private enabled. Private keys/mnemonics will be written to disk (CSV/TXT)."
    );
  }

  if (!dryRun) await fs.ensureDir(outDir);

  // If summaries are disabled, proactively remove old CSV/TXT in outDir to avoid confusion
  if (!dryRun && !summaryFiles) {
    const isUnderOutDir = (p) => path.resolve(p).startsWith(outDir + path.sep);
    try {
      if (isUnderOutDir(csvPath)) await fs.remove(csvPath);
    } catch (_) {}
    try {
      if (isUnderOutDir(txtPath)) await fs.remove(txtPath);
    } catch (_) {}
  }

  // Load keystore password list (if provided)
  let passwordLines = null;
  if (opts.keystorePasswordFile) {
    const pfile = path.resolve(opts.keystorePasswordFile);
    if (!fs.existsSync(pfile)) throw new Error("Keystore password file not found: " + pfile);
    passwordLines = (await fs.readFile(pfile, "utf8")).split(/\r?\n/).filter(Boolean);
  }
  const pickKeystorePassword = (i) =>
    opts.keystorePassword || (passwordLines && passwordLines.length ? passwordLines[i % passwordLines.length] : "");

  // CSV header
  const csvHeader = [
    { id: "id", title: "id" },
    { id: "address", title: "address" },
    { id: "checksumAddress", title: "checksumAddress" },
    { id: "derivationPath", title: "derivation_path" },
    { id: "keystoreFile", title: "keystore_file" },
    { id: "timestamp", title: "timestamp" },
    { id: "note", title: "note" },
  ];
  if (includePrivate) {
    csvHeader.push({ id: "privateKey", title: "private_key_hex" });
    csvHeader.push({ id: "mnemonic", title: "mnemonic" });
  }
  const csvWriter = summaryFiles
    ? createCsvWriter({ path: csvPath, header: csvHeader, append: false })
    : null;

  async function appendTxtLine(line) {
    if (dryRun || !summaryFiles) return;
    await fs.appendFile(txtPath, line + "\n", { encoding: "utf8" });
  }

  // Precompute shared mnemonic for mnemonic-generate
  let sharedMnemonic = null;
  if (modes.includes("mnemonic-generate")) {
    const temp = Wallet.createRandom();
    if (!temp?.mnemonic?.phrase) throw new Error("Failed to create a random mnemonic");
    if (mnemonicWords === 24) {
      console.warn(
        "Note: ethers v6 createRandom() yields 12-word mnemonics by default. 24 words not directly configurable."
      );
    }
    sharedMnemonic = temp.mnemonic.phrase;
  }

  function deriveFromSharedMnemonic(idx) {
    const pathForIndex = `${derivationPathBase}/${startIndex + idx}`;
    return Wallet.fromPhrase(sharedMnemonic, pathForIndex);
  }
  function deriveFromProvidedMnemonic(mnemonic, idx) {
    const pathForIndex = `${derivationPathBase}/${startIndex + idx}`;
    return Wallet.fromPhrase(mnemonic, pathForIndex);
  }

  async function generateOne(i) {
    const ts = new Date().toISOString();
    const out = {
      id: i,
      address: null,
      checksumAddress: null,
      privateKey: null,
      mnemonic: null,
      derivationPath: null,
      keystoreFile: null,
      timestamp: ts,
      note: "",
    };

    let wallet;
    if (modes.includes("mnemonic-derive")) {
      if (!opts.mnemonic) throw new Error("mnemonic-derive mode requires --mnemonic");
      wallet = deriveFromProvidedMnemonic(opts.mnemonic.trim(), i);
      out.mnemonic = opts.mnemonic.trim();
      out.derivationPath = `${derivationPathBase}/${startIndex + i}`;
    } else if (modes.includes("mnemonic-generate")) {
      wallet = deriveFromSharedMnemonic(i);
      out.mnemonic = sharedMnemonic;
      out.derivationPath = `${derivationPathBase}/${startIndex + i}`;
    } else {
      wallet = Wallet.createRandom();
    }

    out.privateKey = wallet.privateKey;
    out.address = wallet.address.toLowerCase();
    out.checksumAddress = getAddress(out.address);

    if (modes.includes("keystore")) {
      const pw = pickKeystorePassword(i);
      const keystoreJson = await wallet.encrypt(pw);
      const filename = `UTC--${ts.replace(/[:]/g, "-")}--${out.address.replace(/^0x/, "")}.json`;
      const keystoreDir = path.join(outDir, "keystore");
      if (!dryRun) {
        await fs.ensureDir(keystoreDir);
        const full = path.join(keystoreDir, filename);
        await fs.writeFile(full, keystoreJson, { encoding: "utf8", mode: chmodMode });
        out.keystoreFile = path.relative(outDir, full);
      } else {
        out.keystoreFile = path.join("keystore", filename);
      }
    }

    return out;
  }

  // Generate with concurrency
  const limit = pLimit(concurrency);
  const tasks = Array.from({ length: count }, (_, i) => limit(() => generateOne(i)));

  let results = [];
  try {
    results = await Promise.all(tasks);
  } catch (err) {
    console.error("Generation error:", err);
    process.exit(1);
  }

  // Write CSV/TXT
  if (!dryRun && summaryFiles) {
    await fs.ensureDir(path.dirname(csvPath));
    await fs.ensureDir(path.dirname(txtPath));
    await fs.writeFile(txtPath, "", { encoding: "utf8" });
  }

  const csvRows = [];
  for (const r of results) {
    const row = {
      id: r.id,
      address: r.address,
      checksumAddress: r.checksumAddress,
      derivationPath: r.derivationPath || "",
      keystoreFile: r.keystoreFile || "",
      timestamp: r.timestamp,
      note: r.note || "",
    };
    if (includePrivate) {
      row.privateKey = r.privateKey;
      row.mnemonic = r.mnemonic || "";
    }
    csvRows.push(row);

    const parts = [
      `id=${r.id}`,
      `address=${r.checksumAddress}`,
      r.derivationPath ? `path=${r.derivationPath}` : null,
      r.keystoreFile ? `keystore=${r.keystoreFile}` : null,
      `ts=${r.timestamp}`,
    ].filter(Boolean);
    if (includePrivate) {
      parts.push(`priv=${r.privateKey}`);
      if (r.mnemonic) parts.push(`mnemonic="${r.mnemonic}"`);
    }
    await appendTxtLine(parts.join(" | "));
  }

  if (!dryRun && summaryFiles && csvWriter) {
    await csvWriter.writeRecords(csvRows);
    try { await fs.chmod(csvPath, chmodMode); } catch (_) {}
    try { await fs.chmod(txtPath, chmodMode); } catch (_) {}
  }

  // Optional validation
  const validationReport = [];
  if (validateAfter) {
    console.log("Validating generated wallets...");
    for (const r of results) {
      let ok = false;
      let error = "";
      try {
        if (r.keystoreFile) {
          const full = path.join(outDir, r.keystoreFile);
          const ks = dryRun ? null : await fs.readFile(full, "utf8");
          const pw = pickKeystorePassword(r.id);
          const w = dryRun ? null : await Wallet.fromEncryptedJson(ks, pw);
          const addr = dryRun ? r.address : w.address.toLowerCase();
          ok = addr === r.address.toLowerCase();
          if (!ok) error = `keystore mismatch: got ${addr}, expected ${r.address}`;
        } else {
          const w = new Wallet(r.privateKey);
          ok = w.address.toLowerCase() === r.address.toLowerCase();
          if (!ok) error = `private key mismatch: got ${w.address}, expected ${r.address}`;
        }
      } catch (e) {
        ok = false;
        error = e?.message || String(e);
      }
      validationReport.push({ id: r.id, address: r.checksumAddress, ok, error });
    }
    const vpath = path.join(outDir, "validation_report.json");
    if (!dryRun) {
      await fs.writeJson(vpath, validationReport, { spaces: 2 });
      try { await fs.chmod(vpath, chmodMode); } catch (_) {}
    }
    console.log("Validation summary:", {
      total: validationReport.length,
      ok: validationReport.filter(x => x.ok).length,
      failed: validationReport.filter(x => !x.ok).length,
    });
  }

  // Generation report
  const genReportPath = path.join(outDir, "generation_report.json");
  if (!dryRun) {
    // Safe report: exclude privateKey & mnemonic unless --include-private
    const safeResults = results.map(r => {
      const { privateKey, mnemonic, ...rest } = r;
      if (includePrivate) return r;
      return rest;
    });
    await fs.writeJson(genReportPath, safeResults, { spaces: 2 });
    try { await fs.chmod(genReportPath, chmodMode); } catch (_) {}
  }

  // Zip (no strong encryption)
  if (opts.zipOutput && !dryRun) {
    const zipPath = path.join(path.dirname(outDir), path.basename(outDir) + ".zip");
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => console.log(`Zip created: ${zipPath} (${archive.pointer()} bytes)`));
    archive.on("error", (err) => { throw err; });
    archive.pipe(output);
    archive.directory(outDir, false);
    if (opts.zipPassword) {
      console.warn("Note: archiver does NOT provide strong zip encryption; use gpg/7z for real encryption.");
    }
    await archive.finalize();
  }

  console.log(`Done. Outputs placed in ${dryRun ? "[dry-run]" : outDir}`);
})();