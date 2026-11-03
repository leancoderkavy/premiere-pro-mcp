import { deriveToolOperationalCapability } from "../../src/tool-capability-report.js";
import { resolveCapabilities } from "../../src/security/capabilities.js";
import { describe, expect, it } from "vitest";
import { getSessionGuardTools, SessionGuardStore } from "../../src/tools/session-guard.js";

describe("set_session_guard", () => {
  const tool = () => {
    const store = new SessionGuardStore();
    return { store, handler: getSessionGuardTools(store).set_session_guard.handler };
  };

  it("stores a valid project path and target and reports them", async () => {
    const { store, handler } = tool();
    const result = await handler({ expected_project_path: "/jobs/scratch.prproj", expected_cep_target: { backend: "cep", sequence_id: "seq-1" } });
    expect(result.success).toBe(true);
    expect(store.get()).toEqual({ expected_project_path: "/jobs/scratch.prproj", expected_cep_target: { backend: "cep", sequence_id: "seq-1" } });
    expect((result.data as { session_guard: { active: boolean } }).session_guard.active).toBe(true);
  });

  it("refuses a relative project path with the request-scoped validator message", async () => {
    const { store, handler } = tool();
    const result = await handler({ expected_project_path: "scratch.prproj" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/absolute saved-project path/);
    expect(store.get()).toEqual({});
  });

  it("refuses a target without backend cep", async () => {
    const { handler } = tool();
    const result = await handler({ expected_cep_target: { backend: "uxp", sequence_id: "seq-1" } });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/backend=cep/);
  });

  it("replaces rather than merges, and clears", async () => {
    const { store, handler } = tool();
    await handler({ expected_project_path: "/a.prproj", expected_cep_target: { backend: "cep", sequence_id: "seq-1" } });
    await handler({ expected_project_path: "/b.prproj" });
    expect(store.get()).toEqual({ expected_project_path: "/b.prproj" });
    const cleared = await handler({ clear: true });
    expect(cleared.success).toBe(true);
    expect(store.get()).toEqual({});
    const mixed = await handler({ clear: true, expected_project_path: "/c.prproj" });
    expect(mixed.success).toBe(false);
  });
});

it("reports session guard as local without requiring a Premiere host", () => {
  const tool = getSessionGuardTools(new SessionGuardStore()).set_session_guard;
  expect(deriveToolOperationalCapability("set_session_guard", tool, resolveCapabilities("inspect"))).toMatchObject({ backends: ["local"], hostVerificationRequired: false });
});
