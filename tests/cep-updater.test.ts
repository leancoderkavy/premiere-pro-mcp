import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
});
