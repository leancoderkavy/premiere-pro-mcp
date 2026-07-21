import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("CEP installation metadata", () => {
  it("keeps the CEP bundle and extension versions aligned with package.json", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const manifest = readFileSync(join(root, "cep-plugin", "CSXS", "manifest.xml"), "utf8");

    expect(manifest).toContain(`ExtensionBundleVersion="${pkg.version}"`);
    expect(manifest.match(new RegExp(`Version="${pkg.version.replaceAll(".", "\\.")}"`, "g"))).toHaveLength(3);
  });

  it("documents the Windows unsigned-extension value as REG_SZ", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const installer = readFileSync(join(root, "scripts", "install-cep.ps1"), "utf8");

    expect(readme).toContain("String (`REG_SZ`)");
    expect(readme).not.toContain("set these DWORD values");
    expect(installer).toContain('-PropertyType String -Value "1"');
  });

  it("copies the macOS plugin for npm installs and supports diagnostics", () => {
    const cli = readFileSync(join(root, "src", "index.ts"), "utf8");
    const installer = readFileSync(join(root, "scripts", "install-cep.sh"), "utf8");
    expect(cli).toContain('execFileSync("bash", [scriptPath, "--copy"]');
    expect(installer).toContain('MODE="${1:-}"');
    expect(installer).toContain('if [ "$MODE" = "--diagnose" ]');
    expect(installer).toContain("Installation verified");
  });

  it("rejects CEP installation on unsupported host operating systems", () => {
    const cli = readFileSync(join(root, "src", "index.ts"), "utf8");
    expect(cli).toContain("supported only on Windows and macOS");
  });
});
