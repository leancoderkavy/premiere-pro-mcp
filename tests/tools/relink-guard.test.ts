import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getMediaTools } from "../../src/tools/media.js";

const mockedSendCommand = vi.mocked(sendCommand);
const relink = getMediaTools({ tempDir: "/tmp/relink-guard", timeoutMs: 5000 }).relink_media;
const directories: string[] = [];

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function existingFile() {
  const directory = mkdtempSync(join(tmpdir(), "premiere-relink-"));
  directories.push(directory);
  const path = join(directory, "target.mp4");
  writeFileSync(path, "test media placeholder");
  return path;
}

describe("CEP relink safety guard (#729)", () => {
  it("refuses a valid target by default before the hanging host call", async () => {
    const result = await relink.handler({ item_id: "clip-1", new_path: existingFile() });
    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining("relink_offline_media_uxp"),
    }));
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("also refuses a missing file when the unsafe route is explicitly requested", async () => {
    const result = await relink.handler({ item_id: "clip-1", new_path: join(tmpdir(), "missing-relink-target.mp4"), allow_unsafe_cep_relink: true });
    expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining("not an existing file") }));
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("labels an opted-in host return unverified, including a false host return", async () => {
    const path = existingFile();
    await relink.handler({ item_id: "clip-1", new_path: path, allow_unsafe_cep_relink: true });
    expect(mockedSendCommand).toHaveBeenCalledOnce();
    const script = String(mockedSendCommand.mock.calls[0][0]);
    const item = { nodeId: "clip-1", name: "clip", changeMediaPath: vi.fn((_path: string, _override: boolean): boolean | number => true) };
    const app = { project: { rootItem: { children: { numItems: 1, 0: item } } } };
    const execute = () => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app })));
    expect(execute()).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ outcome: "committed_unverified", verified: false }),
    }));
    expect(item.changeMediaPath).toHaveBeenCalledWith(path, true);
    item.changeMediaPath.mockReturnValue(0);
    expect(execute()).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ outcome: "committed_unverified", verified: false }),
    }));
    item.changeMediaPath.mockReturnValue(false);
    expect(execute()).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining("did not confirm"),
      data: expect.objectContaining({ outcome: "committed_unverified" }),
    }));
  });
});
