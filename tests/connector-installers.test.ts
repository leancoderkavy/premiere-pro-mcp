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

  it("verifies the shipped Windows installer payload without installing it", () => {
    const source = read("installer/windows/Program.cs");
    const workflow = read(".github/workflows/connector-installers.yml");
    expect(source).toContain('"--verify-only"');
    expect(source).toContain("VerifyEmbeddedPackage");
    expect(source).toContain("premiere-connector-validate");
    expect(source).toContain("GetManifestResourceStream");
    expect(workflow).toContain("--verify-only");
    expect(workflow).toContain("Start-Process");
    expect(workflow).toContain("without installing it");
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

  it("ships a guarded macOS companion uninstaller and blocks Windows removal while Premiere is open", () => {
    const windows = read("installer/windows/Program.cs");
    const macos = read("scripts/build-connector-installer.sh");
    const workflow = read(".github/workflows/connector-installers.yml");
    expect(windows).toContain("Close it before removing the Connector");
    expect(macos).toContain("Premiere-Connector-Uninstall-$VERSION-macos.command");
    expect(macos).toContain("uninstall-cep.sh");
    expect(workflow).toContain("*.command");
  });
});
