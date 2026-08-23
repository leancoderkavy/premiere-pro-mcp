import { describe, expect, it } from "vitest";
import {
  buildProjectIntakeReport,
  validateFacilityIntakeTemplate,
  validateProjectIntakeSnapshot,
} from "../src/intake/project-intake.js";

const template = {
  schemaVersion: 1,
  id: "facility-intake",
  version: "2026-08",
  requiredBins: [{ name: "Incoming" }, { name: "Interviews", parentPath: "Editorial" }],
  allowedExtensions: ["mov", "wav"],
  allowedFrameRates: [23.976, 24],
  proxyPolicy: "require",
  approvedPathPrefixes: [{ id: "show-storage", prefix: "D:/Shows/Current" }],
  organizationRules: [{
    id: "interviews",
    destinationBinName: "Interviews",
    match: { filenamePrefixes: ["INT_"], extensions: ["mov"] },
    colorIndex: 3,
  }],
};

const snapshot = {
  project: { id: "project-1", name: "Documentary" },
  truncated: false,
  unavailableEvidence: [],
  items: [
    { id: "bin-editorial", name: "Editorial", type: "bin", treePath: "Editorial" },
    { id: "bin-incoming", name: "Incoming", type: "bin", treePath: "Incoming" },
    { id: "bin-interviews", name: "Interviews", type: "bin", treePath: "Editorial/Interviews", parentId: "bin-editorial" },
    {
      id: "clip-1", name: "INT_A_001.mov", type: "clip", parentId: "bin-incoming",
      mediaPath: "D:/Shows/Current/Camera/INT_A_001.mov", offline: false, hasProxy: true, frameRate: 23.976,
    },
  ],
};

describe("project intake engine", () => {
  it("validates a bounded facility template and rejects unknown or unsafe shapes", () => {
    const normalized = validateFacilityIntakeTemplate({ ...template, allowedExtensions: ["WAV", ".MOV"] });
    expect(normalized.allowedExtensions).toEqual(["mov", "wav"]);
    expect(normalized.organizationRules[0].match).toEqual({ extensions: ["mov"], filenamePrefixes: ["int_"] });
    expect(() => validateFacilityIntakeTemplate({ ...template, unexpected: true })).toThrow("not supported");
    expect(() => validateFacilityIntakeTemplate({ ...template, organizationRules: [{
      id: "unsafe", destinationBinName: "Unsafe", match: {},
    }] })).toThrow("must include a filename prefix or extension");
    expect(() => validateFacilityIntakeTemplate({ ...template, allowedExtensions: ["../mov"] })).toThrow("simple file extension");
  });

  it("produces a deterministic, read-only, path-redacted organization proposal", () => {
    const report = buildProjectIntakeReport(snapshot, template);
    const reordered = buildProjectIntakeReport({ ...snapshot, items: [...snapshot.items].reverse() }, template);

    expect(report).toMatchObject({
      applied: false,
      status: "ready",
      capture: { itemCount: 4, truncated: false, pathDisclosure: "redacted" },
      organizationPlan: {
        applied: false,
        proposedBins: [{ name: "Interviews", exists: true, createIfApproved: false }],
        proposedMoves: [{ projectItemId: "clip-1", expectedParentId: "bin-incoming", destinationBinName: "Interviews", ruleId: "interviews", colorIndex: 3 }],
      },
    });
    expect(report.findings).toEqual([]);
    expect(report.project.revision).toBe(reordered.project.revision);
    expect(report.template.digest).toBe(reordered.template.digest);
    expect(report.organizationPlan.planDigest).toBe(reordered.organizationPlan.planDigest);
    expect(JSON.stringify(report)).not.toContain("D:/Shows/Current");
  });

  it("reports observed extension, frame-rate, offline, proxy, and path violations without exposing paths by default", () => {
    const report = buildProjectIntakeReport({
      ...snapshot,
      items: snapshot.items.map((item) => item.id === "clip-1" ? {
        ...item,
        name: "INT_A_001.mp4",
        mediaPath: "D:/Unapproved/INT_A_001.mp4",
        frameRate: 29.97,
        offline: true,
        hasProxy: false,
      } : item),
    }, template);

    expect(report.status).toBe("needs_attention");
    expect(report.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "EXTENSION_NOT_ALLOWED", "FRAME_RATE_NOT_ALLOWED", "OFFLINE_MEDIA", "PROXY_MISSING", "MEDIA_PATH_NOT_APPROVED",
    ]));
    const pathFinding = report.findings.find((finding) => finding.code === "MEDIA_PATH_NOT_APPROVED")!;
    expect(pathFinding).toMatchObject({ certainty: "observed", observed: { mediaPathHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(JSON.stringify(report)).not.toContain("D:/Unapproved");

    const disclosed = buildProjectIntakeReport({
      ...snapshot,
      items: snapshot.items.map((item) => item.id === "clip-1" ? { ...item, mediaPath: "D:/Unapproved/INT_A_001.mp4" } : item),
    }, template, { includePaths: true });
    expect(disclosed.capture.pathDisclosure).toBe("requested");
    expect(JSON.stringify(disclosed)).toContain("D:/Unapproved/INT_A_001.mp4");
  });

  it("returns incomplete when required evidence is unavailable and distinguishes optional checks not performed", () => {
    const incomplete = buildProjectIntakeReport({
      project: { id: "project-2" },
      truncated: false,
      unavailableEvidence: ["frame_rate"],
      items: [{ id: "clip-2", name: "Untitled", type: "clip" }],
    }, template);
    expect(incomplete.status).toBe("incomplete");
    expect(incomplete.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "REQUIRED_EVIDENCE_UNAVAILABLE", certainty: "unavailable" }),
      expect.objectContaining({ code: "EXTENSION_UNAVAILABLE", certainty: "unavailable" }),
      expect.objectContaining({ code: "FRAME_RATE_UNAVAILABLE", certainty: "unavailable" }),
      expect.objectContaining({ code: "PROXY_STATE_UNAVAILABLE", certainty: "unavailable" }),
      expect.objectContaining({ code: "MEDIA_PATH_UNAVAILABLE", certainty: "unavailable" }),
    ]));

    const explicitlyRequired = buildProjectIntakeReport({
      project: { id: "project-3" },
      truncated: false,
      unavailableEvidence: [],
      items: [{ id: "clip-3", name: "Untitled", type: "clip" }],
    }, {
      ...template,
      allowedExtensions: [],
      allowedFrameRates: [],
      proxyPolicy: "ignore",
      approvedPathPrefixes: [],
      requiredEvidence: ["extension", "frame_rate", "offline", "proxy", "path"],
    });
    expect(explicitlyRequired.status).toBe("incomplete");
    expect(explicitlyRequired.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "EXTENSION_UNAVAILABLE", "FRAME_RATE_UNAVAILABLE", "OFFLINE_STATE_UNAVAILABLE", "PROXY_STATE_UNAVAILABLE", "MEDIA_PATH_UNAVAILABLE",
    ]));

    const notChecked = buildProjectIntakeReport(snapshot, { ...template, proxyPolicy: "report_missing" });
    const reportWithoutProxyState = buildProjectIntakeReport({
      ...snapshot,
      items: snapshot.items.map((item) => item.id === "clip-1" ? { ...item, hasProxy: undefined } : item),
    }, { ...template, proxyPolicy: "report_missing" });
    expect(notChecked.findings).toEqual([]);
    expect(reportWithoutProxyState.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PROXY_STATE_NOT_CHECKED", certainty: "not_checked", severity: "info" }),
    ]));
  });

  it("flags missing bins, ambiguous organization rules, and truncated captures without proposing a mutation", () => {
    const report = buildProjectIntakeReport({
      ...snapshot,
      truncated: true,
      items: snapshot.items.filter((item) => item.id !== "bin-incoming"),
    }, {
      ...template,
      organizationRules: [
        template.organizationRules[0],
        { id: "also-interviews", destinationBinName: "Also Interviews", match: { filenamePrefixes: ["INT_"] } },
      ],
    });
    expect(report.status).toBe("incomplete");
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CAPTURE_TRUNCATED", certainty: "unavailable" }),
      expect.objectContaining({ code: "REQUIRED_BIN_MISSING", certainty: "observed" }),
      expect.objectContaining({ code: "AMBIGUOUS_ORGANIZATION_RULES", itemId: "clip-1", certainty: "observed" }),
    ]));
    expect(report.organizationPlan.proposedMoves).toEqual([]);
    expect(report.applied).toBe(false);
  });

  it("distinguishes unavailable, incorrect, and suffix-matched required-bin parents", () => {
    const baseItems = snapshot.items.filter((item) => item.id !== "bin-interviews");

    const unavailable = buildProjectIntakeReport({
      ...snapshot,
      items: [...baseItems, { id: "bin-interviews", name: "Interviews", type: "bin" }],
    }, template);
    expect(unavailable.status).toBe("incomplete");
    expect(unavailable.findings).toContainEqual(expect.objectContaining({
      code: "REQUIRED_BIN_PARENT_UNAVAILABLE",
      certainty: "unavailable",
    }));

    const wrong = buildProjectIntakeReport({
      ...snapshot,
      items: [...baseItems, {
        id: "bin-interviews", name: "Interviews", type: "bin", treePath: "Other/Interviews",
      }],
    }, template);
    expect(wrong.status).toBe("needs_attention");
    expect(wrong.findings).toContainEqual(expect.objectContaining({
      code: "REQUIRED_BIN_WRONG_PARENT",
      certainty: "observed",
    }));

    const suffixMatched = buildProjectIntakeReport({
      ...snapshot,
      items: [...baseItems, {
        id: "bin-interviews", name: "Interviews", type: "bin", treePath: "Show/Editorial/Interviews",
      }],
    }, template);
    expect(suffixMatched.findings.some((finding) => finding.code.startsWith("REQUIRED_BIN_"))).toBe(false);
  });

  it("bounds snapshots and rejects malformed evidence before evaluation", () => {
    expect(() => validateProjectIntakeSnapshot({
      project: { id: "project" }, items: [{ id: "one", name: "One", type: "clip" }, { id: "one", name: "Two", type: "clip" }],
      truncated: false, unavailableEvidence: [],
    })).toThrow("duplicate ids");
    expect(() => validateProjectIntakeSnapshot({
      project: { id: "project" }, items: [], truncated: "no", unavailableEvidence: [],
    })).toThrow("must be a boolean");
    expect(() => validateProjectIntakeSnapshot({
      project: { id: "project" }, items: [{ id: "one", name: "One", type: "asset" }],
      truncated: false, unavailableEvidence: [],
    })).toThrow("type must be clip, bin, sequence, or other");
    expect(() => validateProjectIntakeSnapshot({
      project: { id: "project" }, items: [{ id: "one", name: "One", type: "clip", frameRate: 0 }],
      truncated: false, unavailableEvidence: [],
    })).toThrow("finite frame rate");
  });

  it("rejects duplicate and out-of-contract facility rules", () => {
    expect(() => validateFacilityIntakeTemplate({
      ...template,
      approvedPathPrefixes: [{ id: "storage", prefix: "D:/One" }, { id: "storage", prefix: "D:/Two" }],
    })).toThrow("approvedPathPrefixes contains duplicate ids");
    expect(() => validateFacilityIntakeTemplate({
      ...template,
      requiredEvidence: ["proxy", "proxy"],
    })).toThrow("requiredEvidence contains duplicate entries");
    expect(() => validateFacilityIntakeTemplate({
      ...template,
      requiredEvidence: ["duration"],
    })).toThrow("must be extension, frame_rate, offline, proxy, or path");
    expect(() => validateFacilityIntakeTemplate({
      ...template,
      organizationRules: [template.organizationRules[0], { ...template.organizationRules[0] }],
    })).toThrow("organizationRules contains duplicate ids");
    expect(() => validateFacilityIntakeTemplate({
      ...template,
      organizationRules: [{ ...template.organizationRules[0], colorIndex: 15 }],
    })).toThrow("colorIndex must be an integer from 0 through 14");
    expect(() => validateFacilityIntakeTemplate({ ...template, proxyPolicy: "generate" })).toThrow(
      "proxyPolicy must be ignore, report_missing, or require",
    );
  });
});
