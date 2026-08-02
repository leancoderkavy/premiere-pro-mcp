import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("native connector installers", () => {
  it("keeps Windows installation inside the current user's CEP directory", () => {
    const source = read("installer/windows/Program.cs");
    expect(source).toContain("Environment.SpecialFolder.ApplicationData");
    expect(source).toContain("EnsureInsideCepRoot");
    expect(source).toContain("RegistryValueKind.String");
    expect(source).toContain("GetManifestResourceStream");
  });

  it("rejects unsafe ZIP paths and an invalid connector payload", () => {
    const source = read("installer/windows/Program.cs");
    expect(source).toContain("contains an unsafe path");
    expect(source).toContain("CSXS");
    expect(source).toContain("manifest.xml");
  });

  it("makes production signing an explicit fail-closed gate", () => {
    const windows = read("scripts/build-connector-installer.ps1");
    const macos = read("scripts/build-connector-installer.sh");
    const workflow = read(".github/workflows/connector-installers.yml");
    expect(windows).toContain("RequireSigning");
    expect(windows).toContain("Authenticode verification failed");
    expect(macos).toContain("REQUIRE_SIGNING");
    expect(workflow).toContain("require_production_signing");
  });
});
