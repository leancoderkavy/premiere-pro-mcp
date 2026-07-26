import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectExportPresetFile, verifyDeliveryFile } from "../../src/tools/export.js";

const temporaryDirectories: string[] = [];

function temporaryFile(name: string, contents: string | Buffer): string {
  const directory = mkdtempSync(join(tmpdir(), "premiere-delivery-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("delivery file verification", () => {
  it("returns deterministic SHA-256 metadata", async () => {
    const path = temporaryFile("delivery.mov", "premiere delivery\n");
    const result = await verifyDeliveryFile(path);
    expect(result).toMatchObject({
      path,
      exists: true,
      regularFile: true,
      sizeBytes: 18,
      checksum: {
        algorithm: "sha256",
        value: "beabfc0259a7213ae09fffc062f2bdfc69fc0e702ab19ff44b50259b1f02d843",
      },
      valid: true,
    });
  });

  it("reports expected checksum and size mismatches without claiming validity", async () => {
    const path = temporaryFile("delivery.mp4", "video");
    const result = await verifyDeliveryFile(path, {
      expectedChecksum: "0".repeat(64),
      expectedSizeBytes: 99,
    });
    expect(result).toMatchObject({
      matchesExpectedChecksum: false,
      matchesExpectedSize: false,
      valid: false,
    });
  });

  it("rejects missing, empty, and invalid delivery targets", async () => {
    await expect(verifyDeliveryFile("/definitely/missing/delivery.mov")).rejects.toThrow("does not exist");
    const empty = temporaryFile("empty.mov", "");
    await expect(verifyDeliveryFile(empty)).rejects.toThrow("expected at least 1");
    const path = temporaryFile("delivery.mov", "content");
    await expect(verifyDeliveryFile(path, { algorithm: "md5" as never })).rejects.toThrow("sha256");
    await expect(verifyDeliveryFile(path, { expectedChecksum: "not-hex" })).rejects.toThrow("64-character");
  });
});

describe("export preset inspection", () => {
  it("accepts a non-empty regular .epr file", () => {
    const path = temporaryFile("YouTube.epr", "<preset />");
    expect(inspectExportPresetFile(path)).toMatchObject({
      path,
      exists: true,
      regularFile: true,
      sizeBytes: 10,
    });
  });

  it("rejects wrong extensions and empty presets", () => {
    const wrongExtension = temporaryFile("preset.xml", "<preset />");
    expect(() => inspectExportPresetFile(wrongExtension)).toThrow(".epr");
    const empty = temporaryFile("empty.epr", "");
    expect(() => inspectExportPresetFile(empty)).toThrow("empty");
  });
});
