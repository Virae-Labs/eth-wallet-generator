#!/usr/bin/env node
/**
 * unlock-keystore-verify.js
 *
 * Purpose:
 *  - Batch-verify whether keystore JSON files can be decrypted by the provided password
 *  - For each keystore, try ethers.Wallet.fromEncryptedJson(...)
 *  - If the keystore JSON contains "address", verify it matches the decrypted wallet address
 *
 * Usage examples:
 *  # 最简单：指定目录，明文密码（开发环境）
 *  node unlock-keystore-verify.js --in-dir ./wallets_out/keystore --password "StrongPass123"
 *
 *  # 从文件读取密码（第一行）
 *  node unlock-keystore-verify.js --in-dir ./wallets_out/keystore --password-file ./pw.txt
 *
 *  # 从环境变量读取密码（更安全）
 *  PASSWORD_ENV=KS_PASS KS_PASS="StrongPass123" node unlock-keystore-verify.js --in-dir ./wallets_out/keystore --password-env KS_PASS
 *
 *  # 指定通配、并发、超时，并输出报告
 *  node unlock-keystore-verify.js --in-dir ./wallets_out/keystore --pattern "*.json" \
 *    --concurrency 8 --per-file-timeout-ms 20000 --password-file ./pw.txt --write-report
 */

const { Command } = require("commander");
const { Wallet } = require("ethers");
const fs = require("fs-extra");
const path = require("path");
const pLimit = require("p-limit");
const fg = require("fast-glob");

// ---- helpers ----
const int10 = (v) => {
  const n = Number.parseInt(String(v), 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer: ${v}`);
  return n;
};

function readFirstLineTrimmed(s) {
  return String(s).split(/\r?\n/)[0].trim();
}

async function readPassword(opts) {
  // priority: --password > --password-file > --password-env
  if (typeof opts.password === "string" && opts.password.length > 0) {
    return opts.password;
  }
  if (typeof opts.passwordFile === "string" && opts.passwordFile.length > 0) {
    const raw = await fs.readFile(opts.passwordFile, "utf8");
    return readFirstLineTrimmed(raw);
  }
  if (typeof opts.passwordEnv === "string" && opts.passwordEnv.length > 0) {
    const v = process.env[opts.passwordEnv];
    if (!v) throw new Error(`Env var ${opts.passwordEnv} is not set`);
    return v;
  }
  throw new Error("No password provided. Use --password or --password-file or --password-env.");
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`Timeout after ${ms}ms${label ? `: ${label}` : ""}`)), ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    timeout,
  ]);
}

// ---- CLI ----
const program = new Command();
program
  .name("unlock-keystore-verify")
  .description("Verify keystore JSON files can be decrypted with the given password")
  .option("--in-dir <dir>", "directory containing keystore files", "./wallets_out/keystore")
  .option("--pattern <glob>", "glob pattern relative to in-dir", "*.json")
  .option("--concurrency <n>", "number of files to process in parallel", int10, 4)
  .option("--per-file-timeout-ms <n>", "timeout per file in milliseconds", int10, 30000)
  .option("--max-files <n>", "limit how many files to verify (0 = no limit)", int10, 0)
  .option("--password <pw>", "password string (not recommended for production)")
  .option("--password-file <file>", "read password from a file (first line)")
  .option("--password-env <name>", "read password from environment variable name")
  .option("--write-report", "write verification_report.json next to in-dir's parent (or in in-dir if no parent)", false)
  .option("--jsonl", "also write verification.jsonl with one line per result", false)
  .parse(process.argv);

(async () => {
  const opts = program.opts();

  // Resolve and validate inputs
  const inDir = path.resolve(opts.inDir || "./wallets_out/keystore");
  const pattern = String(opts.pattern || "*.json");
  const concurrency = Math.max(1, opts.concurrency || 4);
  const perFileTimeoutMs = Math.max(0, opts.perFileTimeoutMs || 0);
  const maxFiles = Math.max(0, opts.maxFiles || 0);

  let password;
  try {
    password = await readPassword(opts);
  } catch (e) {
    console.error("Failed to read password:", e.message || e);
    process.exit(1);
  }

  if (!(await fs.pathExists(inDir))) {
    console.error(`Input directory does not exist: ${inDir}`);
    process.exit(1);
  }

  // Gather files
  const entries = await fg(pattern, { cwd: inDir, onlyFiles: true, dot: false, absolute: true });
  const files = maxFiles > 0 ? entries.slice(0, maxFiles) : entries;

  if (files.length === 0) {
    console.warn(`No files matched in ${inDir} with pattern "${pattern}".`);
    process.exit(0);
  }

  console.log(`Verifying ${files.length} keystore file(s) from: ${inDir}`);
  console.log(`Concurrency = ${concurrency}, Per-file timeout = ${perFileTimeoutMs}ms\n`);

  const limit = pLimit(concurrency);

  async function verifyOne(file) {
    const rel = path.relative(inDir, file);
    const result = {
      file: rel,
      absolutePath: file,
      ok: false,
      reason: null,
      decryptedAddress: null,
      keystoreAddress: null,
      matchesKeystoreAddress: null,
      timestamp: new Date().toISOString(),
    };

    try {
      const raw = await fs.readFile(file, "utf8");

      // parse keystore for optional address field
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj.address === "string" && obj.address.length > 0) {
          // v3 keystore address field is usually lowercase, no 0x
          result.keystoreAddress = "0x" + obj.address.toLowerCase().replace(/^0x/, "");
        }
      } catch (_) {
        // ignore JSON parse errors here; ethers will still try decrypt
      }

      const wallet = await withTimeout(Wallet.fromEncryptedJson(raw, password), perFileTimeoutMs, rel);
      result.decryptedAddress = wallet.address.toLowerCase();
      result.ok = true;

      if (result.keystoreAddress) {
        result.matchesKeystoreAddress = (result.decryptedAddress === result.keystoreAddress.toLowerCase());
        if (!result.matchesKeystoreAddress) {
          result.reason = `Decrypted address ${result.decryptedAddress} != keystore.address ${result.keystoreAddress}`;
        }
      }
    } catch (e) {
      result.ok = false;
      result.reason = e && e.message ? e.message : String(e);
    }

    return result;
  }

  let results = [];
  try {
    results = await Promise.all(files.map((f) => limit(() => verifyOne(f))));
  } catch (e) {
    console.error("Unexpected verification error:", e.message || e);
    process.exit(1);
  }

  // Summary
  const total = results.length;
  const ok = results.filter(r => r.ok && (r.matchesKeystoreAddress !== false)).length;
  const addrMismatch = results.filter(r => r.ok && r.matchesKeystoreAddress === false).length;
  const failed = total - ok - addrMismatch;

  // Print per-file brief
  for (const r of results) {
    if (r.ok && r.matchesKeystoreAddress !== false) {
      console.log(`[OK]      ${r.file}  ->  ${r.decryptedAddress}`);
    } else if (r.ok && r.matchesKeystoreAddress === false) {
      console.log(`[WARNADDR] ${r.file}  ->  ${r.decryptedAddress} (!= ${r.keystoreAddress})`);
    } else {
      console.log(`[FAIL]    ${r.file}  ->  ${r.reason}`);
    }
  }

  console.log("\nSummary:");
  console.log(`  Total:            ${total}`);
  console.log(`  Success:          ${ok}`);
  console.log(`  Addr mismatch:    ${addrMismatch}`);
  console.log(`  Failed:           ${failed}`);

  // Optional: write reports
  if (opts.writeReport || opts.jsonl) {
    // Determine report dir:
    // If inDir ends with /keystore, put report one-level up (sibling to keystore),
    // else put it inside inDir.
    let reportDir = inDir;
    const base = path.basename(inDir).toLowerCase();
    if (base === "keystore") {
      reportDir = path.dirname(inDir);
    }
    await fs.ensureDir(reportDir);

    if (opts.writeReport) {
      const reportPath = path.join(reportDir, "verification_report.json");
      await fs.writeJson(reportPath, {
        inputDir: inDir,
        pattern,
        concurrency,
        perFileTimeoutMs,
        total,
        success: ok,
        addressMismatch: addrMismatch,
        failed,
        results,
        generatedAt: new Date().toISOString(),
      }, { spaces: 2 });
      console.log(`\nReport written: ${reportPath}`);
    }

    if (opts.jsonl) {
      const jsonlPath = path.join(reportDir, "verification.jsonl");
      const lines = results.map(r => JSON.stringify(r)).join("\n") + "\n";
      await fs.writeFile(jsonlPath, lines, "utf8");
      console.log(`JSONL written: ${jsonlPath}`);
    }
  }

  // Exit codes
  if (failed === 0 && addrMismatch === 0) {
    process.exit(0); // all good
  } else if (failed === 0 && addrMismatch > 0) {
    process.exit(2); // only address mismatch warnings
  } else {
    process.exit(2); // some failures
  }
})().catch((e) => {
  console.error("Fatal error:", e && e.message ? e.message : e);
  process.exit(1);
});