#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { buildUxpHybridCcxReceipt } from "./uxp-hybrid-ccx-receipt-core.mjs";

function receiptError(message) {
  const error = new Error(message);
  error.code = "UXP_HYBRID_CCX_RECEIPT_INVALID";
  return error;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--ccx", "--addon-receipt", "--sdk-header-receipt", "--output"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw receiptError(`${argument} requires a value`);
      if (argument === "--ccx") options.ccxPath = value;
      else if (argument === "--addon-receipt") options.addonReceiptPath = value;
      else if (argument === "--sdk-header-receipt") options.sdkHeaderReceiptPath = value;
      else options.outputPath = value;
    } else if (argument === "--check") options.check = true;
    else if (argument === "--validate-only") options.validateOnly = true;
    else throw receiptError(`Unknown argument: ${argument}`);
  }
  if (options.check && options.validateOnly) throw receiptError("--check and --validate-only cannot be combined");
  if (!options.ccxPath || !options.addonReceiptPath || !options.sdkHeaderReceiptPath) {
    throw receiptError("--ccx, --addon-receipt, and --sdk-header-receipt are required");
  }
  if (!options.validateOnly && !options.outputPath) throw receiptError("--output is required unless --validate-only is used");
  return options;
}

async function readJson(path, label) {
  try { return JSON.parse(await readFile(resolve(path), "utf8")); } catch { throw receiptError(`${label} must be a readable JSON receipt`); }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [addonReceipt, sdkHeaderReceipt] = await Promise.all([
    readJson(options.addonReceiptPath, "addonReceipt"),
    readJson(options.sdkHeaderReceiptPath, "sdkHeaderReceipt"),
  ]);
  const receipt = await buildUxpHybridCcxReceipt({ ccxPath: resolve(options.ccxPath), addonReceipt, sdkHeaderReceipt });
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.validateOnly) {
    process.stdout.write(`Validated CCX archive with ${receipt.stats.artifacts} addon artifacts and ${receipt.stats.entrypoints} entrypoint.\n`);
    return;
  }
  const outputPath = resolve(options.outputPath);
  if (options.check) {
    let current = "";
    try { current = await readFile(outputPath, "utf8"); } catch {}
    if (current.replaceAll("\r\n", "\n") !== rendered) {
      throw receiptError("UXP Hybrid CCX receipt is stale; rerun without --check after reviewing the local archive");
    }
    process.stdout.write(`UXP Hybrid CCX receipt is current: ${receipt.stats.artifacts} artifacts and ${receipt.stats.entrypoints} entrypoint.\n`);
    return;
  }
  await writeFile(outputPath, rendered);
  process.stdout.write(`Wrote UXP Hybrid CCX receipt: ${receipt.stats.artifacts} artifacts and ${receipt.stats.entrypoints} entrypoint.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
