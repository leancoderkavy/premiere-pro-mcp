import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../src/server.js";

describe("session guard transport discovery", () => {
  it.each(["compact", "full"])("keeps list and capability discovery consistent in %s profile", async schemaProfile => {
    const server = createServer({}, { schemaProfile, toolPacks: "essential" });
    const client = new Client({ name: "guard-discovery-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const listed = await client.listTools();
      expect(listed.tools.some(tool => tool.name === "set_session_guard")).toBe(schemaProfile === "compact");
      for (const available_only of [true, false]) {
        const result = await client.callTool({ name: "get_capabilities", arguments: {
          tool_names: ["set_session_guard"], available_only,
        } });
        expect(result.isError).not.toBe(true);
        const data = JSON.parse((result.content as { text: string }[])[0].text);
        expect(data.tools.tools).toEqual(schemaProfile === "compact"
          ? [expect.objectContaining({ name: "set_session_guard", registered: true })] : []);
      }
    } finally {
      await client.close();
      await server.close();
    }
  }, 60000);
});
