import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOperationId,
  emitAudit,
  stderrAuditSink,
} from "../src/security/audit.js";

describe("security audit helpers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates UUID operation identifiers", () => {
    expect(createOperationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("adds an ISO timestamp before emitting an audit event", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T21:30:00.000Z"));
    const sink = vi.fn();

    emitAudit(sink, {
      operationId: "operation-1",
      action: "project.inspect",
      outcome: "succeeded",
      details: { clips: 2 },
    });

    expect(sink).toHaveBeenCalledWith({
      operationId: "operation-1",
      action: "project.inspect",
      outcome: "succeeded",
      details: { clips: 2 },
      timestamp: "2026-08-15T21:30:00.000Z",
    });
    vi.useRealTimers();
  });

  it("writes one protocol-safe JSON line to stderr", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stderrAuditSink({
      operationId: "operation-2",
      action: "media.export",
      outcome: "denied",
      timestamp: "2026-08-15T21:31:00.000Z",
    });

    expect(error).toHaveBeenCalledOnce();
    expect(JSON.parse(String(error.mock.calls[0][0]))).toEqual({
      type: "premiere-mcp-audit",
      operationId: "operation-2",
      action: "media.export",
      outcome: "denied",
      timestamp: "2026-08-15T21:31:00.000Z",
    });
  });
});

type JsonRecord = Record<string, unknown>;

function validManifest(): JsonRecord {
  return {
    schemaVersion: 1,
    source: {
      apiPackage: "@adobe/premierepro",
      apiVersion: "26.3.0",
      changelogUrl: "https://developer.adobe.com/premiere-pro/uxp/changelog/",
    },
    entries: [validEntry()],
  };
}

function validEntry(): JsonRecord {
  return {
    id: "test-entry",
    adobeApi: ["Project.test"],
    documentationUrls: [
      "https://developer.adobe.com/premiere-pro/uxp/ppro-reference/",
    ],
    minimumPremiereVersion: "26.3.0",
    backend: "uxp",
    uxpCommand: null,
    mcpTools: ["test_tool"],
    availability: "current",
    implementationStatus: "implemented",
    verificationStatus: "automated_contract_verified",
    liveHostVerificationStatus: "not_run",
    mutatesProject: false,
    undoable: false,
    idempotency: "not_applicable",
    verificationBoundary: "test_result",
  };
}

async function importWithManifest(manifest: unknown): Promise<unknown> {
  vi.resetModules();
  vi.doMock("node:module", () => ({
    createRequire: () => () => manifest,
  }));
  return import("../src/platform-capabilities.js");
}

describe("Adobe UXP manifest validation", () => {
  afterEach(() => {
    vi.doUnmock("node:module");
    vi.resetModules();
  });

  const invalidCases: Array<[string, (manifest: JsonRecord) => unknown, RegExp]> = [
    ["requires an object manifest", () => null, /must be an object/],
    ["requires schema version one", (m) => ({ ...m, schemaVersion: 2 }), /schemaVersion/],
    ["requires an object source", (m) => ({ ...m, source: [] }), /source must be an object/],
    ["requires the Premiere API package", (m) => ({ ...m, source: { ...(m.source as JsonRecord), apiPackage: "other" } }), /source package/],
    ["requires a source API version", (m) => ({ ...m, source: { ...(m.source as JsonRecord), apiVersion: "" } }), /apiVersion/],
    ["rejects malformed URLs", (m) => ({ ...m, source: { ...(m.source as JsonRecord), changelogUrl: "not a url" } }), /valid URL/],
    ["rejects non-Adobe documentation", (m) => ({ ...m, source: { ...(m.source as JsonRecord), changelogUrl: "https://example.com/premiere-pro/uxp/" } }), /official Premiere Pro UXP/],
    ["requires entries", (m) => ({ ...m, entries: [] }), /non-empty array/],
    ["requires entry objects", (m) => ({ ...m, entries: [null] }), /entry 0 must be an object/],
    ["requires entry identifiers", (m) => ({ ...m, entries: [{ ...validEntry(), id: "" }] }), /entry 0.id/],
    ["requires kebab-case identifiers", (m) => ({ ...m, entries: [{ ...validEntry(), id: "Not Kebab" }] }), /unique kebab-case/],
    ["rejects duplicate identifiers", (m) => ({ ...m, entries: [validEntry(), validEntry()] }), /unique kebab-case/],
    ["requires documentation arrays", (m) => ({ ...m, entries: [{ ...validEntry(), documentationUrls: [] }] }), /documentationUrls/],
    ["requires current or planned availability", (m) => ({ ...m, entries: [{ ...validEntry(), availability: "future" }] }), /availability/],
    ["requires a supported implementation status", (m) => ({ ...m, entries: [{ ...validEntry(), implementationStatus: "partial" }] }), /implementationStatus/],
    ["requires a supported verification status", (m) => ({ ...m, entries: [{ ...validEntry(), verificationStatus: "maybe" }] }), /verificationStatus/],
    ["requires a supported live-host status", (m) => ({ ...m, entries: [{ ...validEntry(), liveHostVerificationStatus: "maybe" }] }), /liveHostVerificationStatus/],
    ["requires supported idempotency", (m) => ({ ...m, entries: [{ ...validEntry(), idempotency: "sometimes" }] }), /idempotency/],
    ["requires the UXP backend", (m) => ({ ...m, entries: [{ ...validEntry(), backend: "cep" }] }), /backend must be uxp/],
    ["requires a nullable string command", (m) => ({ ...m, entries: [{ ...validEntry(), uxpCommand: 42 }] }), /uxpCommand/],
    ["requires boolean mutation metadata", (m) => ({ ...m, entries: [{ ...validEntry(), mutatesProject: "no" }] }), /mutation metadata/],
    ["requires non-empty API arrays", (m) => ({ ...m, entries: [{ ...validEntry(), adobeApi: [""] }] }), /adobeApi/],
    ["requires a minimum version", (m) => ({ ...m, entries: [{ ...validEntry(), minimumPremiereVersion: null }] }), /minimumPremiereVersion/],
    ["requires MCP tool arrays", (m) => ({ ...m, entries: [{ ...validEntry(), mcpTools: "tool" }] }), /mcpTools/],
    ["requires a verification boundary", (m) => ({ ...m, entries: [{ ...validEntry(), verificationBoundary: "" }] }), /verificationBoundary/],
  ];

  it.each(invalidCases)("%s", async (_name, mutate, expected) => {
    await expect(importWithManifest(mutate(validManifest()))).rejects.toThrow(expected);
  });

  it("accepts every supported manifest enum variant", async () => {
    const manifest = validManifest();
    manifest.entries = [
      validEntry(),
      {
        ...validEntry(),
        id: "planned-entry",
        availability: "planned",
        implementationStatus: "planned",
        verificationStatus: "committed_unverified",
        liveHostVerificationStatus: "verified",
        idempotency: "operation_id",
        uxpCommand: "test.command",
      },
      {
        ...validEntry(),
        id: "unstarted-entry",
        verificationStatus: "not_started",
        idempotency: "operation_id_when_supported",
      },
    ];

    const module = await importWithManifest(manifest) as {
      buildAdobeUxpCoverageReport: () => { summary: Record<string, number> };
      buildPlatformCapabilityReport: (
        capabilities: { source: "default"; capabilities: Set<"inspect"> },
        platform: NodeJS.Platform,
        tempDirectory: string,
      ) => { runtime: { platformName: string; supported: boolean }; authority: { enabled: string[] } };
      platformName: (platform: NodeJS.Platform) => string;
    };
    expect(module.buildAdobeUxpCoverageReport().summary).toMatchObject({
      total: 3,
      current: 2,
      planned: 1,
      implemented: 2,
      committedUnverified: 1,
      automatedContractVerified: 1,
      liveHostVerified: 1,
    });
    expect(module.platformName("darwin")).toBe("macOS");
    expect(module.platformName("win32")).toBe("Windows");
    expect(module.platformName("linux")).toBe("linux");
    expect(module.buildPlatformCapabilityReport(
      { source: "default", capabilities: new Set(["inspect"]) },
      "linux",
      "/private/bridge",
    )).toMatchObject({
      runtime: { platformName: "linux", supported: false, tempDirectory: "/private/bridge" },
      authority: { enabled: ["inspect"] },
    });
  });
});
