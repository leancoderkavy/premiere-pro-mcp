import { createRequire } from "node:module";
import { join, win32 } from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const updater = require(join(process.cwd(), "cep-plugin", "updater.cjs"));

describe("CEP connector updater", () => {
  it("compares release versions numerically", () => {
    expect(updater.compareVersions("v1.10.0", "1.9.9")).toBe(1);
    expect(updater.compareVersions("1.3.1", "1.3.1")).toBe(0);
    expect(updater.compareVersions("1.3.0", "1.3.1")).toBe(-1);
  });

  it("prefers the signed connector package", () => {
    const release = {
      html_url: "https://github.com/leancoderkavy/premiere-pro-mcp/releases/tag/v1.4.0",
      assets: [
        {
          name: "source.zip",
          browser_download_url: "https://github.com/example/source.zip",
        },
        {
          name: "MCPBridgeCEP.zxp",
          browser_download_url:
            "https://github.com/leancoderkavy/premiere-pro-mcp/releases/download/v1.4.0/MCPBridgeCEP.zxp",
        },
      ],
    };

    expect(updater.chooseDownloadUrl(release)).toContain("MCPBridgeCEP.zxp");
  });

  it("rejects untrusted download hosts", () => {
    expect(updater.isTrustedDownloadUrl("https://github.com/example/file.zxp")).toBe(true);
    expect(updater.isTrustedDownloadUrl("https://evil.example/file.zxp")).toBe(false);
  });

  it("reads the latest global package version from the npm registry record", () => {
    const update = updater.updateStateFromPackageRecord("1.14.7", {
      "dist-tags": { latest: "v1.14.8" },
    });

    expect(updater.LATEST_PACKAGE_API).toBe("https://registry.npmjs.org/premiere-pro-mcp");
    expect(update).toEqual({
      currentVersion: "1.14.7",
      latestVersion: "1.14.8",
      updateAvailable: true,
    });
    expect(() => updater.latestPackageVersion({ "dist-tags": { latest: "nightly" } }))
      .toThrow("valid latest version");
  });

  it("creates a detached Windows updater that waits for Premiere instead of closing it", () => {
    const scriptPath = "C:\\Temp\\premiere-pro-mcp-update-abc.ps1";
    const statusPath = "C:\\Temp\\premiere-pro-mcp-update-abc.json";
    const cliPath = "C:\\Users\\editor\\AppData\\Roaming\\npm\\premiere-pro-mcp.cmd";
    const script = updater.buildWindowsGlobalUpdateScript(cliPath, statusPath, scriptPath);

    expect(script).toContain("while (Get-Process -Name $premiereProcesses");
    expect(script).toContain("Start-Sleep -Seconds 2");
    expect(script).toContain("Get-Command npm.cmd");
    expect(script).toContain("& $npmCommand install --global 'premiere-pro-mcp@latest'");
    expect(script).toContain("& $cliPath --install-cep");
    expect(script).toContain("premiere-pro-mcp.desktop-update.v1");
    expect(script).not.toContain("Stop-Process");
  });

  it("schedules only an existing absolute per-user command and cleans up if launch fails", () => {
    const writes = new Map<string, string>();
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));
    const runtime = {
      fs: {
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn((file: string, value: string) => writes.set(file, value)),
        unlinkSync: vi.fn(),
      },
      path: win32,
      os: { tmpdir: () => "C:\\Temp" },
      childProcess: { spawn },
      crypto: { randomBytes: () => Buffer.from("abcdef", "hex") },
    };
    const cliPath = "C:\\Users\\editor\\AppData\\Roaming\\npm\\premiere-pro-mcp.cmd";
    const scheduled = updater.scheduleWindowsGlobalUpdate({ cliPath, runtime });

    expect(scheduled.statusPath).toBe("C:\\Temp\\premiere-pro-mcp-update-abcdef.json");
    expect(writes.get("C:\\Temp\\premiere-pro-mcp-update-abcdef.ps1"))
      .toContain("& $npmCommand install --global 'premiere-pro-mcp@latest'");
    expect(spawn).toHaveBeenCalledWith(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\Temp\\premiere-pro-mcp-update-abcdef.ps1"],
      { detached: true, windowsHide: true, stdio: "ignore" },
    );
    expect(unref).toHaveBeenCalledOnce();

    expect(() => updater.scheduleWindowsGlobalUpdate({ cliPath: "relative.cmd", runtime }))
      .toThrow("could not be resolved");

    const failingRuntime = {
      ...runtime,
      childProcess: { spawn: vi.fn(() => { throw new Error("launch failed"); }) },
    };
    expect(() => updater.scheduleWindowsGlobalUpdate({ cliPath, runtime: failingRuntime }))
      .toThrow("launch failed");
    expect(runtime.fs.unlinkSync).toHaveBeenCalled();
  });
});
