import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { generateNativeSdkHeaderInventory } from "../scripts/generate-native-sdk-header-inventory.mjs";

async function writeFixture(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function linkDirectory(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

describe("native SDK header-inventory receipt", () => {
  it("accounts for the documented UXP Hybrid headers without recording contents or absolute paths", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-native-sdk-"));
    const sdkRoot = join(directory, "hybrid-sdk");
    const archivePath = join(directory, "hybrid-sdk.zip");
    try {
      writeFileSync(archivePath, "authorized SDK fixture");
      await writeFixture(sdkRoot, "src/api/UxpAddonTypes.h", "typedef void* addon_value;");
      await writeFixture(sdkRoot, "src/api/UxpAddonShared.h", "void uxp_addon_example(void);");
      await writeFixture(sdkRoot, "src/utilities/UxpAddon.h", "#define UXP_ADDON_INIT(x)");
      await writeFixture(sdkRoot, "src/utilities/internal.hpp", "namespace fixture {}");
      const inventory = await generateNativeSdkHeaderInventory({
        sdk: "uxp-hybrid",
        sdkVersion: "7.3.0-fixture",
        archivePath,
        sdkRoot,
      });

      expect(inventory).toMatchObject({
        schemaVersion: 1,
        source: {
          sdk: "uxp-hybrid",
          authorityUrl: "https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/",
          inventoryScope: "header_files_only",
          archiveSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          includeDirectories: ["src/api", "src/utilities"],
        },
        stats: { headers: 4 },
      });
      expect(inventory.headers.map((header) => header.path)).toEqual([
        "src/api/UxpAddonShared.h",
        "src/api/UxpAddonTypes.h",
        "src/utilities/UxpAddon.h",
        "src/utilities/internal.hpp",
      ]);
      expect(JSON.stringify(inventory)).not.toContain(sdkRoot);
      expect(JSON.stringify(inventory)).not.toContain("typedef void*");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires documented Hybrid headers and explicit PrSDK include directories", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-native-sdk-invalid-"));
    const sdkRoot = join(directory, "sdk");
    const archivePath = join(directory, "sdk.zip");
    try {
      writeFileSync(archivePath, "authorized SDK fixture");
      await writeFixture(sdkRoot, "src/api/UxpAddonTypes.h", "typedef void* addon_value;");
      await writeFixture(sdkRoot, "src/api/UxpAddonShared.h", "void uxp_addon_example(void);");
      await writeFixture(sdkRoot, "src/utilities/Other.h", "#define OTHER 1");
      await expect(generateNativeSdkHeaderInventory({
        sdk: "uxp-hybrid", sdkVersion: "fixture", archivePath, sdkRoot,
      })).rejects.toThrow("Missing required UXP Hybrid SDK header");

      await writeFixture(sdkRoot, "Headers/PrSDKFixture.h", "class PrSDKFixture {};");
      await expect(generateNativeSdkHeaderInventory({
        sdk: "premiere-prsdk", sdkVersion: "fixture", archivePath, sdkRoot,
      })).rejects.toThrow("requires one or more explicit includeDirectories");
      await expect(generateNativeSdkHeaderInventory({
        sdk: "premiere-prsdk", sdkVersion: "fixture", archivePath, sdkRoot,
        includeDirectories: ["Headers"],
      })).resolves.toMatchObject({
        source: { sdk: "premiere-prsdk", includeDirectories: ["Headers"] },
        stats: { headers: 1 },
      });
      await expect(generateNativeSdkHeaderInventory({
        sdk: "premiere-prsdk", sdkVersion: "fixture", archivePath, sdkRoot,
        includeDirectories: ["Headers/"],
      })).rejects.toThrow("must use a canonical relative path");
      await expect(generateNativeSdkHeaderInventory({
        sdk: "premiere-prsdk", sdkVersion: "fixture", archivePath, sdkRoot,
        includeDirectories: ["C:Headers"],
      })).rejects.toThrow("must stay relative to the SDK root");
      await expect(generateNativeSdkHeaderInventory({
        sdk: "constructor", sdkVersion: "fixture", archivePath, sdkRoot,
      })).rejects.toThrow("sdk must be uxp-hybrid or premiere-prsdk");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects include-root and intermediate links that resolve outside the SDK root", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-native-sdk-links-"));
    const archivePath = join(directory, "sdk.zip");
    const prsdkRoot = join(directory, "prsdk");
    const hybridRoot = join(directory, "hybrid");
    const outsideHeaders = join(directory, "outside-headers");
    const outsideSrc = join(directory, "outside-src");
    try {
      writeFileSync(archivePath, "authorized SDK fixture");
      await mkdir(prsdkRoot, { recursive: true });
      await writeFixture(outsideHeaders, "PrSDKFixture.h", "class PrSDKFixture {};");
      linkDirectory(outsideHeaders, join(prsdkRoot, "Headers"));
      await expect(generateNativeSdkHeaderInventory({
        sdk: "premiere-prsdk", sdkVersion: "fixture", archivePath, sdkRoot: prsdkRoot,
        includeDirectories: ["Headers"],
      })).rejects.toThrow("must stay inside the SDK root");

      await mkdir(hybridRoot, { recursive: true });
      await writeFixture(outsideSrc, "api/UxpAddonTypes.h", "typedef void* addon_value;");
      await writeFixture(outsideSrc, "api/UxpAddonShared.h", "void uxp_addon_example(void);");
      await writeFixture(outsideSrc, "utilities/UxpAddon.h", "#define UXP_ADDON_INIT(x)");
      linkDirectory(outsideSrc, join(hybridRoot, "src"));
      await expect(generateNativeSdkHeaderInventory({
        sdk: "uxp-hybrid", sdkVersion: "fixture", archivePath, sdkRoot: hybridRoot,
      })).rejects.toThrow("must stay inside the SDK root");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes a deterministic receipt and rejects a stale check", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-native-sdk-cli-"));
    const sdkRoot = join(directory, "hybrid-sdk");
    const archivePath = join(directory, "hybrid-sdk.zip");
    const outputPath = join(directory, "inventory.json");
    const script = "scripts/generate-native-sdk-header-inventory.mjs";
    try {
      writeFileSync(archivePath, "authorized SDK fixture");
      await writeFixture(sdkRoot, "src/api/UxpAddonTypes.h", "typedef void* addon_value;");
      await writeFixture(sdkRoot, "src/api/UxpAddonShared.h", "void uxp_addon_example(void);");
      await writeFixture(sdkRoot, "src/utilities/UxpAddon.h", "#define UXP_ADDON_INIT(x)");
      const args = [script, "--sdk", "uxp-hybrid", "--sdk-version", "fixture", "--archive", archivePath, "--sdk-root", sdkRoot, "--output", outputPath];
      expect(spawnSync(process.execPath, args, { encoding: "utf8" }).status).toBe(0);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({ stats: { headers: 3 } });
      expect(spawnSync(process.execPath, [...args, "--check"], { encoding: "utf8" }).status).toBe(0);
      writeFileSync(join(sdkRoot, "src/api/UxpAddonShared.h"), "changed");
      const stale = spawnSync(process.execPath, [...args, "--check"], { encoding: "utf8" });
      expect(stale.status).not.toBe(0);
      expect(stale.stderr).toContain("Native SDK header inventory is stale");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
