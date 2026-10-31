import { describe, expect, it, vi } from "vitest";

// Full catalog setup can contend with other processes on a loaded machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../src/server.js";

// Local planners snap to frames at a 30 fps default. Live testing with 25 fps
// event footage produced frame numbers 20% too high with no hint why.
async function callPlanner(args: Record<string, unknown>) {
  const server = createServer({ timeoutMs: 50 });
  const client = new Client({ name: "frame-rate-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: "plan_word_mute_ranges", arguments: args });
    return result.structuredContent as { ok: boolean; data?: { frame_rate?: number; warnings?: string[] } };
  } finally {
    await client.close();
    await server.close();
  }
}

const wordTimeline = {
  source_project_item_id: "000f426c",
  transcript_revision: `sha256:${"a".repeat(64)}`,
  words: [
    { text: "more", start_seconds: 44.1, end_seconds: 44.5 },
    { text: "than", start_seconds: 44.5, end_seconds: 44.8 },
    { text: "concrete", start_seconds: 45.2, end_seconds: 45.7 },
  ],
};

describe("frame_rate default warning", () => {
  it("warns when a planner falls back to 30 fps", async () => {
    const result = await callPlanner({ word_timeline: wordTimeline, words: ["concrete"] });
    expect(result.ok).toBe(true);
    expect(result.data?.frame_rate).toBe(30);
    expect(result.data?.warnings).toContainEqual(expect.stringContaining("frame_rate was not given"));
  });

  it("stays quiet when the caller passes the sequence frame rate", async () => {
    const result = await callPlanner({ word_timeline: wordTimeline, words: ["concrete"], frame_rate: 25 });
    expect(result.data?.frame_rate).toBe(25);
    expect(JSON.stringify(result.data?.warnings ?? [])).not.toContain("frame_rate was not given");
  });
});
