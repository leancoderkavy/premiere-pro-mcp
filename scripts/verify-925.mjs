#!/usr/bin/env node
// Live Windows/Premiere verification for KAV-312. Requires `npm run build`.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const ranges = Array.from({ length: 10 }, (_, index) => ({ start: 10 + index * 10, end: 11 + index * 10 }));
const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: process.env });
const client = new Client({ name: "kav-312-live-verifier", version: "1.0.0" });

function data(result) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const value = data(result);
  if (result.isError || value.success === false) throw new Error(`${name}: ${value.error ?? JSON.stringify(value)}`);
  return value.data ?? value;
}

const results = [];
try {
  await client.connect(transport);
  await call("verify_premiere_connection", { backend: "cep" });
  for (const batchSize of [8, 4, 16]) {
    const request = { ranges, scope: "sync_locked", range_content: "delete", batch_size: batchSize };
    const preview = await call("ripple_remove_timeline_ranges", request);
    const applied = await call("ripple_remove_timeline_ranges", { ...request, dry_run: false, confirmation_token: preview.confirmationToken });
    results.push({ batchSize, pass: applied.verified === true, undoSteps: applied.undoSteps ?? null, undoStackIndex: applied.undoStackIndex ?? null });
  }
  const expected = Number(process.env.KAV312_UNDO_INDEX);
  if (Number.isInteger(expected) && expected >= 41) {
    const undone = await call("multiple_undo", { count: 41, batch_size: 8, expected_undo_stack_index: expected });
    results.push({ multipleUndo41: undone.undone === 41 && undone.stackVerified === true, undoSteps: undone.undone, undoStackIndex: undone.undoStackIndexAfter });
  } else {
    results.push({ multipleUndo41: "SKIPPED: set KAV312_UNDO_INDEX after preparing 41 undoable test actions" });
  }
  console.log(JSON.stringify({ pass: results.every((item) => item.pass !== false && item.multipleUndo41 !== false), results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ pass: false, error: String(error), results }, null, 2));
  process.exitCode = 1;
} finally {
  await client.close();
}
