import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  canonicalNativeSdkHeaderInventorySha256,
  verifyNativeSdkHeaderInventory,
} from "./verify-native-sdk-header-inventory.mjs";
import {
  canonicalUxpHybridAddonReceiptSha256,
  verifyUxpHybridAddonReceipt,
} from "./verify-uxp-hybrid-addon-receipt.mjs";
import {
  buildUxpHybridCcxReceipt,
  canonicalUxpHybridCcxReceiptSha256,
  verifyUxpHybridCcxReceipt,
} from "./uxp-hybrid-ccx-receipt-core.mjs";

export const REQUIRED_TARGETS = ["win-x64", "mac-x64", "mac-arm64"];
const LOCAL_CCX_ARCHIVE_REQUIRED = "A local CCX archive must be rechecked for schemaVersion 3.";

export function verifyHybridBenchmarkEvidence(document, options = {}) {
  const minimumSpeedupPercent = finiteOption(options.minimumSpeedupPercent, 30, "minimumSpeedupPercent");
  const maximumMemoryRegressionPercent = finiteOption(options.maximumMemoryRegressionPercent, 10, "maximumMemoryRegressionPercent");
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return verdict(errors.concat("Evidence must be a JSON object."), [], minimumSpeedupPercent, maximumMemoryRegressionPercent);
  }
  const receiptBound = document.schemaVersion === 2 || document.schemaVersion === 3;
  const packageBound = document.schemaVersion === 3;
  const expectedEvidenceKeys = packageBound
    ? ["schemaVersion", "workloadId", "configuration", "memoryMeasurement", "sdkHeaderReceiptSha256", "addonReceiptSha256", "ccxReceiptSha256", "runs"]
    : receiptBound
      ? ["schemaVersion", "workloadId", "configuration", "memoryMeasurement", "sdkHeaderReceiptSha256", "runs"]
      : ["schemaVersion", "workloadId", "configuration", "memoryMeasurement", "runs"];
  if (!sameKeys(document, expectedEvidenceKeys)) {
    errors.push("Evidence must contain only the documented benchmark receipt fields.");
  }
  if (document.schemaVersion !== 1 && document.schemaVersion !== 2 && document.schemaVersion !== 3) {
    errors.push("schemaVersion must be 1, 2, or 3.");
  }
  if (document.workloadId !== "weighted-energy-v1") errors.push("workloadId must be weighted-energy-v1.");
  if (receiptBound && !/^[a-f0-9]{64}$/.test(String(document.sdkHeaderReceiptSha256 || ""))) {
    errors.push("sdkHeaderReceiptSha256 must be a canonical SDK header receipt SHA-256 digest.");
  }
  if (packageBound && !/^[a-f0-9]{64}$/.test(String(document.addonReceiptSha256 || ""))) {
    errors.push("addonReceiptSha256 must be a canonical addon-layout receipt SHA-256 digest.");
  }
  if (packageBound && !/^[a-f0-9]{64}$/.test(String(document.ccxReceiptSha256 || ""))) {
    errors.push("ccxReceiptSha256 must be a canonical CCX receipt SHA-256 digest.");
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
  if (packageBound) validatePackageReceipts(document, options, sdkVersions, targets, errors);
  else if (receiptBound) validateSdkReceipt(document, options.sdkHeaderReceipt, sdkVersions, errors);
  if (packageBound) errors.push(LOCAL_CCX_ARCHIVE_REQUIRED);
  return verdict(errors, Array.from(targets.keys()).sort(), minimumSpeedupPercent, maximumMemoryRegressionPercent, document.schemaVersion);
}

function validatePackageReceipts(document, options, sdkVersions, targets, errors) {
  const { sdkHeaderReceipt, addonReceipt, ccxReceipt } = options;
  if (!sdkHeaderReceipt) errors.push("A verified UXP Hybrid SDK header receipt is required.");
  if (!addonReceipt) errors.push("A verified current UXP Hybrid addon-layout receipt is required.");
  if (!ccxReceipt) errors.push("A verified UXP Hybrid CCX receipt is required.");
  if (!sdkHeaderReceipt || !addonReceipt || !ccxReceipt) return;
  try {
    const sdk = verifyNativeSdkHeaderInventory(sdkHeaderReceipt);
    if (sdk.sdk !== "uxp-hybrid") errors.push("SDK header receipt must identify uxp-hybrid.");
    if (sdkVersions.size === 1 && sdkHeaderReceipt.source.sdkVersion !== Array.from(sdkVersions)[0]) {
      errors.push("SDK header receipt sdkVersion must match all benchmark runs.");
    }
    if (document.sdkHeaderReceiptSha256 !== canonicalNativeSdkHeaderInventorySha256(sdkHeaderReceipt)) {
      errors.push("sdkHeaderReceiptSha256 does not match the verified SDK header receipt.");
    }

    verifyUxpHybridAddonReceipt(addonReceipt, { sdkHeaderReceipt });
    if (document.addonReceiptSha256 !== canonicalUxpHybridAddonReceiptSha256(addonReceipt)) {
      errors.push("addonReceiptSha256 does not match the verified addon-layout receipt.");
    }

    verifyUxpHybridCcxReceipt(ccxReceipt, { addonReceipt, sdkHeaderReceipt });
    if (document.ccxReceiptSha256 !== canonicalUxpHybridCcxReceiptSha256(ccxReceipt)) {
      errors.push("ccxReceiptSha256 does not match the verified CCX receipt.");
    }

    for (const [target, run] of targets) {
      const artifact = addonReceipt.artifacts.find((entry) => entry.target === target);
      if (!artifact || run.addonSha256 !== artifact.sha256) {
        errors.push(`runs for ${target} must match the corresponding addon-layout artifact SHA-256.`);
      }
    }
  } catch (error) {
    errors.push(`Hybrid package receipt is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function verifyHybridBenchmarkEvidenceWithLocalCcx(document, options = {}) {
  const result = verifyHybridBenchmarkEvidence(document, options);
  if (document?.schemaVersion !== 3) return result;
  const structuralErrors = result.errors.filter((error) => error !== LOCAL_CCX_ARCHIVE_REQUIRED);
  if (structuralErrors.length > 0) return result;
  if (typeof options.ccxPath !== "string" || !options.ccxPath.trim() || options.ccxPath.includes("\0")) {
    return ineligible({ ...result, errors: structuralErrors }, "A local CCX archive path is required for schemaVersion 3.");
  }
  try {
    const current = await buildUxpHybridCcxReceipt({
      ccxPath: options.ccxPath,
      addonReceipt: options.addonReceipt,
      sdkHeaderReceipt: options.sdkHeaderReceipt,
    });
    if (canonicalUxpHybridCcxReceiptSha256(current) !== canonicalUxpHybridCcxReceiptSha256(options.ccxReceipt)) {
      return ineligible({ ...result, errors: structuralErrors }, "CCX receipt does not match the supplied local archive.");
    }
    return { ...result, promotionEligible: true, errors: structuralErrors };
  } catch (error) {
    return ineligible({ ...result, errors: structuralErrors }, `CCX archive is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function ineligible(result, error) {
  return { ...result, promotionEligible: false, errors: [...result.errors, error] };
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

function verdict(errors, targets, minimumSpeedupPercent, maximumMemoryRegressionPercent, schemaVersion) {
  const verificationBoundary = schemaVersion === 3
    ? "submitted_cross_platform_release_build_and_verified_sdk_addon_ccx_receipt_evidence"
    : schemaVersion === 2
      ? "submitted_cross_platform_release_build_and_verified_sdk_receipt_evidence"
      : "submitted_cross_platform_release_build_evidence";
  return {
    promotionEligible: errors.length === 0,
    errors,
    targets,
    thresholds: { minimumSpeedupPercent, maximumMemoryRegressionPercent },
    verificationBoundary,
  };
}

function parseArguments(argv) {
  const result = {
    input: null,
    sdkHeaderReceipt: null,
    addonReceipt: null,
    ccxReceipt: null,
    ccxPath: null,
    minimumSpeedupPercent: 30,
    maximumMemoryRegressionPercent: 10,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") result.input = argv[++index];
    else if (value === "--sdk-header-receipt") result.sdkHeaderReceipt = argv[++index];
    else if (value === "--addon-receipt") result.addonReceipt = argv[++index];
    else if (value === "--ccx-receipt") result.ccxReceipt = argv[++index];
    else if (value === "--ccx") result.ccxPath = argv[++index];
    else if (value === "--min-speedup-percent") result.minimumSpeedupPercent = Number(argv[++index]);
    else if (value === "--max-memory-regression-percent") result.maximumMemoryRegressionPercent = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!result.input) throw new Error("--input <evidence.json> is required.");
  return result;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const [document, sdkHeaderReceipt, addonReceipt, ccxReceipt] = await Promise.all([
    readEvidenceJson(args.input, "benchmark evidence"),
    args.sdkHeaderReceipt ? readEvidenceJson(args.sdkHeaderReceipt, "SDK header receipt") : undefined,
    args.addonReceipt ? readEvidenceJson(args.addonReceipt, "addon-layout receipt") : undefined,
    args.ccxReceipt ? readEvidenceJson(args.ccxReceipt, "CCX receipt") : undefined,
  ]);
  const result = await verifyHybridBenchmarkEvidenceWithLocalCcx(document, {
    ...args,
    sdkHeaderReceipt,
    addonReceipt,
    ccxReceipt,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.promotionEligible) process.exitCode = 1;
}

async function readEvidenceJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`${label} must be a readable JSON document.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
