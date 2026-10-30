import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn(),
  sendRawCommand: vi.fn(),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getSequenceTools } from "../../src/tools/sequence.js";

describe("duplicate_sequence", () => {
  it("returns the new copy's id even when an older copy has the same name (live: reruns edited the old copy)", async () => {
    const list: Array<Record<string, unknown>> = [];
    const make = (name: string, id: string) => {
      const seq: Record<string, unknown> = { name, sequenceID: id };
      seq.clone = () => { list.push(make(`${name} Copy`, `new-${list.length}`)); };
      return seq;
    };
    list.push(make("Sweep", "orig"), make("Sweep Copy", "old-copy"));
    const sequences = new Proxy({}, { get: (_t, k) => (k === "numSequences" ? list.length : list[Number(k)]) });
    vi.mocked(sendCommand).mockImplementation(async (script: string) =>
      JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project: { sequences, activeSequence: list[0] } } }))));
    await expect(getSequenceTools({ tempDir: "/tmp/dup" } as BridgeOptions).duplicate_sequence.handler({ sequence_id: "orig" }))
      .resolves.toMatchObject({ success: true, data: { name: "Sweep Copy", id: "new-2", originalId: "orig", verified: true, audioRoutingVerified: false, verificationScope: expect.stringContaining("routing was not verified") } });
  });
});
