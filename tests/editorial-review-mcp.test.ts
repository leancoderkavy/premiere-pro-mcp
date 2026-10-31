import { describe, expect, it, vi } from "vitest";

// Full catalog setup can contend with other processes on a loaded machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../src/server.js";

const revision = `sha256:${"a".repeat(64)}`;
describe("editorial review MCP integration", () => {
  it("advertises read-only local reviews and executes quote decisions through the assistant pack", async () => {
    const server = createServer({}, { toolPacks: "assistant-edit", telemetry: { enabled: false, capture() {}, async shutdown() {} } });
    const client = new Client({ name: "review-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const tools = await client.listTools();
      for (const name of ["review_dialogue_candidates", "review_quote_paper_edit", "review_text_changes", "review_sync_evidence", "review_broll_placements"]) {
        expect(tools.tools.find((t) => t.name === name)?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      }
      const segments = [{ id: "q", source_project_item_id: "source", transcript_revision: revision, start_seconds: 2, end_seconds: 4, text: "Quote" }];
      const first = await client.callTool({ name: "review_quote_paper_edit", arguments: { segments } });
      const data = (first.structuredContent as any).data;
      expect(data.rows).toEqual([]);
      const selected = await client.callTool({ name: "review_quote_paper_edit", arguments: { segments, quote_order: ["q"], expected_review_revision: data.review_revision } });
      expect((selected.structuredContent as any).data).toMatchObject({ output_duration_seconds: 2, applied: false, host_verified: false });
      const stale = await client.callTool({ name: "review_quote_paper_edit", arguments: { segments: [{ ...segments[0], text: "Changed" }], quote_order: ["q"], expected_review_revision: data.review_revision } });
      expect(stale.isError).toBe(true);
      expect((stale.structuredContent as any).ok).toBe(false);
    } finally {
      await client.close(); await server.close();
    }
  });
});
