#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  buildUxpHybridCcxReceipt,
  canonicalUxpHybridCcxReceiptSha256,
  verifyUxpHybridCcxReceipt,
} from "./uxp-hybrid-ccx-receipt-core.mjs";

function receiptError(message) {
  const error = new Error(message);
  error.code = "UXP_HYBRID_CCX_RECEIPT_INVALID";
  return error;
}

function parseArguments(argv) {
  const options = { printCanonicalSha256: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--print-canonical-sha256") options.printCanonicalSha256 = true;
    else if (["--input", "--ccx", "--addon-receipt", "--sdk-header-receipt"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw receiptError(`${argument} requires a value`);
      if (argument === "--input") options.inputPath = value;
      else if (argument === "--ccx") options.ccxPath = value;
      else if (argument === "--addon-receipt") options.addonReceiptPath = value;
      else options.sdkHeaderReceiptPath = value;
    } else throw receiptError(`Unknown argument: ${argument}`);
  }
  if (!options.inputPath || !options.ccxPath || !options.addonReceiptPath || !options.sdkHeaderReceiptPath) {
    throw receiptError("Usage: node scripts/verify-uxp-hybrid-ccx-receipt.mjs --input <receipt.json> --ccx <archive.ccx> --addon-receipt <addon-receipt.json> --sdk-header-receipt <sdk-header-receipt.json> [--print-canonical-sha256]");
  }
  return options;
}

async function readJson(path, label) {
  try { return JSON.parse(await readFile(resolve(path), "utf8")); } catch { throw receiptError(`${label} must be a readable JSON receipt`); }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [receipt, addonReceipt, sdkHeaderReceipt] = await Promise.all([
    readJson(options.inputPath, "input"),
    readJson(options.addonReceiptPath, "addonReceipt"),
    readJson(options.sdkHeaderReceiptPath, "sdkHeaderReceipt"),
  ]);
  verifyUxpHybridCcxReceipt(receipt, { addonReceipt, sdkHeaderReceipt });
  const current = await buildUxpHybridCcxReceipt({ ccxPath: resolve(options.ccxPath), addonReceipt, sdkHeaderReceipt });
  if (canonicalUxpHybridCcxReceiptSha256(receipt) !== canonicalUxpHybridCcxReceiptSha256(current)) {
    throw receiptError("UXP Hybrid CCX receipt does not match the supplied local archive");
  }
  process.stdout.write(`UXP Hybrid CCX receipt is valid: ${receipt.stats.artifacts} addon artifacts and ${receipt.stats.entrypoints} entrypoint.\n`);
  if (options.printCanonicalSha256) process.stdout.write(`Canonical receipt SHA-256: ${canonicalUxpHybridCcxReceiptSha256(receipt)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
