import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  canonicalNativeSdkHeaderInventorySha256,
  verifyNativeSdkHeaderInventory,
} from "./verify-native-sdk-header-inventory.mjs";

export const REQUIRED_TARGETS = ["win-x64", "mac-x64", "mac-arm64"];

export function verifyHybridBenchmarkEvidence(document, options = {}) {
  const minimumSpeedupPercent = finiteOption(options.minimumSpeedupPercent, 30, "minimumSpeedupPercent");
  const maximumMemoryRegressionPercent = finiteOption(options.maximumMemoryRegressionPercent, 10, "maximumMemoryRegressionPercent");
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return verdict(errors.concat("Evidence must be a JSON object."), [], minimumSpeedupPercent, maximumMemoryRegressionPercent);
  }
  if (!sameKeys(document, ["schemaVersion", "workloadId", "configuration", "memoryMeasurement", "sdkHeaderReceiptSha256", "runs"])) {
    errors.push("Evidence must contain only the documented benchmark receipt fields.");
  }
  if (document.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (document.workloadId !== "weighted-energy-v1") errors.push("workloadId must be weighted-energy-v1.");
  if (!/^[a-f0-9]{64}$/.test(String(document.sdkHeaderReceiptSha256 || ""))) {
    errors.push("sdkHeaderReceiptSha256 must be a canonical SDK header receipt SHA-256 digest.");
  }
  const expectedConfiguration = { sampleCount: 30, warmupCount: 3, iterations: 4, inputLength: 131072, seed: 1337 };
  if (!sameConfiguration(document.configuration, expectedConfiguration)) {
    errors.push("configuration must match the versioned weighted-energy-v1 benchmark settings.");
  }
  if (typeof document.memoryMeasurement !== "string" || !document.memoryMeasurement.trim()) {
    errors.push("memoryMeasurement must identify the process peak-working-set collection method.");
  }
  if (!Array.isArray(document.runs)) errors.push("runs must be an array.");
  const runs = Array.isArray(document.runs) ? document.runs : [];
  const targets = new Map();
  const commits = new Set();
  const sdkVersions = new Set();
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index], prefix = `runs[${index}]`;
    if (!run || typeof run !== "object" || Array.isArray(run)) {
      errors.push(`${prefix} must be an object.`);
      continue;
    }
    if (!sameKeys(run, ["platform", "arch", "hostVersion", "sdkVersion", "buildMode", "addonLoaded", "addonSha256", "sourceCommit", "checksumMatch", "codeSigned", "notarized", "javascript", "native"])) {
      errors.push(`${prefix} must contain only the documented benchmark fields.`);
    }
    const target = `${run.platform || ""}-${run.arch || ""}`;
    if (!REQUIRED_TARGETS.includes(target)) errors.push(`${prefix} has unsupported target ${target}.`);
    else if (targets.has(target)) errors.push(`${prefix} duplicates target ${target}.`);
    else targets.set(target, run);
    if (!versionAtLeast(String(run.hostVersion || ""), "26.2.0")) {
      errors.push(`${prefix}.hostVersion must be stable Premiere 26.2.0 or newer.`);
    }
    if (typeof run.sdkVersion !== "string" || !run.sdkVersion.trim()) errors.push(`${prefix}.sdkVersion is required.`);
    else sdkVersions.add(run.sdkVersion);
    if (run.buildMode !== "Release") errors.push(`${prefix}.buildMode must be Release.`);
    if (run.addonLoaded !== true) errors.push(`${prefix}.addonLoaded must be true.`);
    if (!/^[a-f0-9]{64}$/.test(String(run.addonSha256 || ""))) errors.push(`${prefix}.addonSha256 must be a lowercase SHA-256 digest.`);
    if (!/^[a-f0-9]{40}$/.test(String(run.sourceCommit || ""))) errors.push(`${prefix}.sourceCommit must be a full Git SHA.`);
    else commits.add(run.sourceCommit);
    if (run.checksumMatch !== true) errors.push(`${prefix}.checksumMatch must be true.`);
    if (target.startsWith("mac-") && (run.codeSigned !== true || run.notarized !== true)) {
      errors.push(`${prefix} must record signed and notarized macOS addon evidence.`);
    }
    validateMetrics(run.javascript, `${prefix}.javascript`, errors);
    validateMetrics(run.native, `${prefix}.native`, errors);
    if (validMetrics(run.javascript) && validMetrics(run.native)) {
      const p50Speedup = speedup(run.javascript.p50Ms, run.native.p50Ms);
      const p95Speedup = speedup(run.javascript.p95Ms, run.native.p95Ms);
      if (p50Speedup < minimumSpeedupPercent) errors.push(`${prefix} p50 speedup ${p50Speedup.toFixed(2)}% is below ${minimumSpeedupPercent}%.`);
      if (p95Speedup < minimumSpeedupPercent) errors.push(`${prefix} p95 speedup ${p95Speedup.toFixed(2)}% is below ${minimumSpeedupPercent}%.`);
      const jsMemory = run.javascript.peakWorkingSetBytes, nativeMemory = run.native.peakWorkingSetBytes;
      const memoryRegression = (nativeMemory - jsMemory) / jsMemory * 100;
      if (memoryRegression > maximumMemoryRegressionPercent) {
        errors.push(`${prefix} memory regression ${memoryRegression.toFixed(2)}% exceeds ${maximumMemoryRegressionPercent}%.`);
      }
    }
  }
  for (const target of REQUIRED_TARGETS) if (!targets.has(target)) errors.push(`Missing required ${target} evidence.`);
  if (commits.size > 1) errors.push("All runs must measure the same sourceCommit.");
  if (commits.size === 0) errors.push("A shared full sourceCommit is required.");
  if (sdkVersions.size > 1) errors.push("All runs must use the same UXP Hybrid SDK version.");
  validateSdkReceipt(document, options.sdkHeaderReceipt, sdkVersions, errors);
  return verdict(errors, Array.from(targets.keys()).sort(), minimumSpeedupPercent, maximumMemoryRegressionPercent);
}

function validateSdkReceipt(document, receipt, sdkVersions, errors) {
  if (!receipt) {
    errors.push("A verified UXP Hybrid SDK header receipt is required.");
    return;
  }
  try {
    const summary = verifyNativeSdkHeaderInventory(receipt);
    if (summary.sdk !== "uxp-hybrid") errors.push("SDK header receipt must identify uxp-hybrid.");
    if (sdkVersions.size === 1 && receipt.source.sdkVersion !== Array.from(sdkVersions)[0]) {
      errors.push("SDK header receipt sdkVersion must match all benchmark runs.");
    }
    if (document.sdkHeaderReceiptSha256 !== canonicalNativeSdkHeaderInventorySha256(receipt)) {
      errors.push("sdkHeaderReceiptSha256 does not match the verified SDK header receipt.");
    }
  } catch (error) {
    errors.push(`SDK header receipt is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateMetrics(value, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} metrics are required.`);
    return;
  }
  if (!sameKeys(value, ["sampleCount", "p50Ms", "p95Ms", "peakWorkingSetBytes"])) {
    errors.push(`${label} must contain only the documented metric fields.`);
  }
  if (!Number.isInteger(value.sampleCount) || value.sampleCount < 20) errors.push(`${label}.sampleCount must be at least 20.`);
  for (const key of ["p50Ms", "p95Ms", "peakWorkingSetBytes"]) {
    if (!Number.isFinite(value[key]) || value[key] <= 0) errors.push(`${label}.${key} must be a positive finite number.`);
  }
  if (Number.isFinite(value.p50Ms) && Number.isFinite(value.p95Ms) && value.p95Ms < value.p50Ms) {
    errors.push(`${label}.p95Ms cannot be lower than p50Ms.`);
  }
}

function validMetrics(value) {
  return value && Number.isFinite(value.p50Ms) && value.p50Ms > 0 && Number.isFinite(value.p95Ms) && value.p95Ms > 0 &&
    Number.isFinite(value.peakWorkingSetBytes) && value.peakWorkingSetBytes > 0;
}

function speedup(baseline, candidate) {
  return (baseline - candidate) / baseline * 100;
}

function sameConfiguration(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(expected);
  return Object.keys(value).length === keys.length && keys.every((key) => value[key] === expected[key]);
}

function sameKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function versionAtLeast(value, minimum) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) return false;
  const left = value.split(".").map(Number), right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

function finiteOption(value, fallback, name) {
  const result = value == null ? fallback : Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 1000) throw new Error(`${name} must be between 0 and 1000.`);
  return result;
}

function verdict(errors, targets, minimumSpeedupPercent, maximumMemoryRegressionPercent) {
  return {
    promotionEligible: errors.length === 0,
    errors,
    targets,
    thresholds: { minimumSpeedupPercent, maximumMemoryRegressionPercent },
    verificationBoundary: "submitted_cross_platform_release_build_and_verified_sdk_receipt_evidence"
  };
}

function parseArguments(argv) {
  const result = { input: null, sdkHeaderReceipt: null, minimumSpeedupPercent: 30, maximumMemoryRegressionPercent: 10 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") result.input = argv[++index];
    else if (value === "--sdk-header-receipt") result.sdkHeaderReceipt = argv[++index];
    else if (value === "--min-speedup-percent") result.minimumSpeedupPercent = Number(argv[++index]);
    else if (value === "--max-memory-regression-percent") result.maximumMemoryRegressionPercent = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!result.input || !result.sdkHeaderReceipt) throw new Error("--input <evidence.json> and --sdk-header-receipt <receipt.json> are required.");
  return result;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const [document, sdkHeaderReceipt] = await Promise.all([
    readFile(args.input, "utf8").then(JSON.parse),
    readFile(args.sdkHeaderReceipt, "utf8").then(JSON.parse),
  ]);
  const result = verifyHybridBenchmarkEvidence(document, { ...args, sdkHeaderReceipt });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.promotionEligible) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
