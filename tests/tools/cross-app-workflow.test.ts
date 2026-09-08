import { describe, expect, it } from "vitest";
import { getCrossAppWorkflowTools, planCrossAppWorkflow } from "../../src/tools/cross-app-workflow.js";
import { annotationsForTool } from "../../src/workflows/tool-metadata.js";
import { capabilityForTool } from "../../src/security/capabilities.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../../src/server.js";

describe("cross-app workflow planning", () => {
  it("registers over MCP and references only tools in the full catalog", async () => {
    const server = createServer({}, { telemetry: { enabled: false, capture() {}, async shutdown() {} } });
    const client = new Client({ name: "cross-app-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const names = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        page.tools.forEach(tool => names.add(tool.name));
        cursor = page.nextCursor;
      } while (cursor);
      expect(names.has("plan_cross_app_workflow")).toBe(true);
      for (const workflow of ["ae_mogrt_to_premiere", "ae_render_to_premiere"]) {
        for (const tool of planCrossAppWorkflow({ workflow }).required_tools) expect(names.has(tool), tool).toBe(true);
        const result = await client.callTool({ name: "plan_cross_app_workflow", arguments: { workflow } });
        expect(result.isError).not.toBe(true);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("keeps creation and Premiere import behind separate previews and approvals", () => {
    const plan = planCrossAppWorkflow({ workflow: "ae_mogrt_to_premiere" });
    expect(plan.applied).toBe(false);
    expect(plan.execution_supported).toBe(false);
    expect(plan.steps.find(s => s.id === "create")).toMatchObject({ depends_on: ["preview_creation"], approval: "confirm_export" });
    expect(plan.steps.find(s => s.id === "import")).toMatchObject({ depends_on: ["preview_import"], approval: "confirm_import" });
    expect(plan.steps.findIndex(s => s.id === "verify_artifact")).toBeLessThan(plan.steps.findIndex(s => s.id === "preview_import"));
    expect(plan.steps.at(-1)?.evidence_required).toMatch(/Rendered frame inspected/);
    expect(plan.manual_steps).toEqual([]);
  });

  it("stops between enqueue and file verification for a manual render", () => {
    const plan = planCrossAppWorkflow({ workflow: "ae_render_to_premiere" });
    expect(plan.manual_steps).toEqual(["render"]);
    expect(plan.steps.find(s => s.id === "render")).toMatchObject({ tool: null, depends_on: ["enqueue"] });
    expect(plan.steps.find(s => s.id === "verify_output")?.depends_on).toEqual(["render"]);
    expect(plan.steps.find(s => s.id === "import")?.approval).toMatch(/Explicit user approval/);
    expect(plan.steps.find(s => s.id === "import")?.instruction).toMatch(/no preview token/);
    expect(plan.steps.at(-1)?.evidence_required).toMatch(/No timeline placement/);
  });

  it.each(["ae_mogrt_to_premiere", "ae_render_to_premiere"])("returns deterministic serial plans without execution evidence: %s", workflow => {
    const plan = planCrossAppWorkflow({ workflow });
    expect(plan).toEqual(planCrossAppWorkflow({ workflow }));
    expect(plan.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.next_step).toBe(plan.steps[0].id);
    expect(new Set(plan.steps.map(s => s.id)).size).toBe(plan.steps.length);
    for (const [index, step] of plan.steps.entries()) {
      expect(step.depends_on).toEqual(index ? [plan.steps[index - 1].id] : []);
      expect(step.status).toBe("not_executed");
      expect(step.on_failure).toMatch(/do not replay completed mutations/);
    }
    plan.steps[0].instruction = "modified";
    expect(planCrossAppWorkflow({ workflow }).steps[0].instruction).not.toBe("modified");
  });

  it.each([null, [], {}, { workflow: "photoshop_to_premiere" }, { workflow: "ae_mogrt_to_premiere", script: "alert(1)" }, { workflow: "ae_mogrt_to_premiere", confirm_export: true }, { workflow: "ae_mogrt_to_premiere", completed_steps: ["create"] }])("rejects invalid or authority-bearing input %j", async args => {
    expect((await getCrossAppWorkflowTools().plan_cross_app_workflow.handler(args)).success).toBe(false);
  });

  it("is an inspect-only tool with read-only MCP annotations", () => {
    expect(capabilityForTool("plan_cross_app_workflow")).toBe("inspect");
    expect(annotationsForTool("plan_cross_app_workflow")).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  });
});
