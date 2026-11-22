import { describe, expect, it, vi, afterEach } from "vitest";
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { cleanupTempDirs, makePrivateBridgeTempDir } from "../helpers/temp-dir.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withInvocationContext, markHostDispatch } from "../../src/workflows/invocation-context.js";

afterEach(() => {
  cleanupTempDirs();
});

describe("CEP preflight refusal preservation (KAV-441 / issue #998)", () => {
  it("preserves refusedBeforeChange=true with not_applied outcome even after priorDispatch", async () => {
    const tempDir = makePrivateBridgeTempDir("refusal-preservation-");
    
    await withInvocationContext({ progressToken: "token-1", notify: vi.fn() }, async () => {
      // Mark as dispatched to simulate a prior successful command in this invocation
      markHostDispatch();
      
      // Simulate a command that returns a refusal before making changes
      const commandPromise = sendCommand(
        `__result({ mutationOutcome: "not_applied", timelineChanged: false, refusedBeforeChange: true })`,
        { tempDir, timeoutMs: 1000 }
      );
      
      // Wait a bit for the command file to be written
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Find and respond to the command file
      const { readdirSync } = await import("node:fs");
      const files = readdirSync(tempDir);
      const cmdFile = files.find(f => f.startsWith("cmd_") && f.endsWith(".jsx"));
      if (cmdFile) {
        const resFile = cmdFile.replace(/^cmd_/, "res_").replace(/\.jsx$/, ".json");
        writeFileSync(
          join(tempDir, resFile),
          JSON.stringify({
            success: false,
            error: "Insert refused; nothing was changed. These tracks must shift but are locked: video track 0.",
            data: {
              mutationOutcome: "not_applied",
              timelineChanged: false,
              refusedBeforeChange: true,
            },
          }),
          { mode: 0o600 }
        );
      }
      
      const result = await commandPromise;
      
      // The key assertion: even though priorDispatch was true, the refusal's
      // not_applied outcome should be preserved, not overridden to unknown
      expect(result.success).toBe(false);
      expect(result.data).toMatchObject({
        mutationOutcome: "not_applied",
        timelineChanged: false,
        refusedBeforeChange: true,
      });
      
      // The outcome should NOT be "unknown"
      expect((result.data as any).mutationOutcome).not.toBe("unknown");
    });
  });

  it("preserves not_applied for locked track without priorDispatch", async () => {
    const tempDir = makePrivateBridgeTempDir("refusal-no-prior-");
    
    await withInvocationContext({ progressToken: "token-2", notify: vi.fn() }, async () => {
      // Do NOT mark as dispatched - this is the first command
      
      const commandPromise = sendCommand(
        `__result({ mutationOutcome: "not_applied", timelineChanged: false, refusedBeforeChange: true })`,
        { tempDir, timeoutMs: 1000 }
      );
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const { readdirSync } = await import("node:fs");
      const files = readdirSync(tempDir);
      const cmdFile = files.find(f => f.startsWith("cmd_") && f.endsWith(".jsx"));
      if (cmdFile) {
        const resFile = cmdFile.replace(/^cmd_/, "res_").replace(/\.jsx$/, ".json");
        writeFileSync(
          join(tempDir, resFile),
          JSON.stringify({
            success: false,
            error: "Bin not found: TestBin",
            data: {
              mutationOutcome: "not_applied",
              timelineChanged: false,
              refusedBeforeChange: true,
            },
          }),
          { mode: 0o600 }
        );
      }
      
      const result = await commandPromise;
      
      // Even without priorDispatch, the refusal should be preserved as not_applied
      expect(result.success).toBe(false);
      expect(result.data).toMatchObject({
        mutationOutcome: "not_applied",
        timelineChanged: false,
      });
      expect((result.data as any).mutationOutcome).not.toBe("unknown");
    });
  });

  it("preserves not_applied for multiple consecutive refusals", async () => {
    const tempDir = makePrivateBridgeTempDir("refusal-consecutive-");
    
    await withInvocationContext({ progressToken: "token-3", notify: vi.fn() }, async () => {
      // First refusal
      const cmd1Promise = sendCommand(
        `__result({ mutationOutcome: "not_applied", timelineChanged: false, refusedBeforeChange: true })`,
        { tempDir, timeoutMs: 1000 }
      );
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      let { readdirSync } = await import("node:fs");
      let files = readdirSync(tempDir);
      let cmdFile = files.find(f => f.startsWith("cmd_") && f.endsWith(".jsx"));
      if (cmdFile) {
        const resFile = cmdFile.replace(/^cmd_/, "res_").replace(/\.jsx$/, ".json");
        writeFileSync(
          join(tempDir, resFile),
          JSON.stringify({
            success: false,
            error: "Track is locked",
            data: {
              mutationOutcome: "not_applied",
              timelineChanged: false,
              refusedBeforeChange: true,
            },
          }),
          { mode: 0o600 }
        );
      }
      
      const result1 = await cmd1Promise;
      expect(result1.success).toBe(false);
      expect((result1.data as any).mutationOutcome).toBe("not_applied");
      
      // Second refusal - even though the first command was sent, it was a refusal
      // so there's still no priorDispatch mutation that succeeded
      const cmd2Promise = sendCommand(
        `__result({ mutationOutcome: "not_applied", timelineChanged: false, refusedBeforeChange: true })`,
        { tempDir, timeoutMs: 1000 }
      );
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      files = readdirSync(tempDir);
      cmdFile = files.filter(f => f.startsWith("cmd_") && f.endsWith(".jsx")).slice(-1)[0];
      if (cmdFile) {
        const resFile = cmdFile.replace(/^cmd_/, "res_").replace(/\.jsx$/, ".json");
        writeFileSync(
          join(tempDir, resFile),
          JSON.stringify({
            success: false,
            error: "Bin not found",
            data: {
              mutationOutcome: "not_applied",
              timelineChanged: false,
              refusedBeforeChange: true,
            },
          }),
          { mode: 0o600 }
        );
      }
      
      const result2 = await cmd2Promise;
      expect(result2.success).toBe(false);
      expect((result2.data as any).mutationOutcome).toBe("not_applied");
    });
  });
});
