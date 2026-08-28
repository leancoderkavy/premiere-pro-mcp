import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compareCmx3600Edls,
  getInterchangeAnalysisTools,
  inspectFcpxml,
  parseCmx3600Edl,
  timecodeToFrames,
  validateCmx3600Edl,
} from "../../src/tools/interchange-analysis.js";

const tools = getInterchangeAnalysisTools({ tempDir: "/tmp/interchange-analysis" });

const BASE_EDL = [
  "TITLE: Round trip",
  "FCM: NON-DROP FRAME",
  "001  CAM_A    V     C        00:00:00:00 00:00:01:00 01:00:00:00 01:00:01:00",
  "002  CAM_B    V     D 024    00:00:01:00 00:00:02:00 01:00:01:00 01:00:02:00",
].join("\n");

function writeFixture(name: string, contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "premiere-interchange-"));
  const path = join(directory, name);
  writeFileSync(path, contents);
  return path;
}

describe("CMX 3600 parsing and validation", () => {
  it("parses CMX headers, cut and dissolve events, and bounded malformed numeric lines", () => {
    const parsed = parseCmx3600Edl(`${BASE_EDL}\n003 incomplete event`);

    expect(parsed).toMatchObject({
      title: "Round trip",
      frameCodeMode: "NON-DROP FRAME",
      events: [
        { eventNumber: 1, reel: "CAM_A", transition: "C", transitionDurationFrames: null },
        { eventNumber: 2, reel: "CAM_B", transition: "D", transitionDurationFrames: 24 },
      ],
      unrecognizedEventLines: [{ line: 5, text: "003 incomplete event" }],
    });
  });

  it("converts non-drop and valid drop-frame timecodes while rejecting invalid forms", () => {
    expect(timecodeToFrames("00:00:01:00", 24)).toBe(24);
    expect(timecodeToFrames("00:01:00;02", 29.97)).toBe(1_800);
    expect(timecodeToFrames("00:01:00;04", 59.94)).toBe(3_600);
    expect(() => timecodeToFrames("00:00:00;00", 24)).toThrow("Drop-frame separator");
    expect(() => timecodeToFrames("00:01:00;00", 29.97)).toThrow("Invalid dropped frame");
    expect(() => timecodeToFrames("00:00:60:00", 24)).toThrow("Invalid timecode fields");
    expect(() => timecodeToFrames("not timecode", 24)).toThrow("Invalid timecode");
  });

  it("detects duplicate IDs, invalid durations, overlaps, gaps, and invalid event timecodes", () => {
    const parsed = parseCmx3600Edl([
      "001  CAM_A V C 00:00:01:00 00:00:00:00 01:00:00:00 01:00:01:00",
      "001  CAM_B V C 00:00:00:00 00:00:01:00 01:00:00:12 01:00:01:12",
      "003  CAM_C V C 00:00:00:00 00:00:01:00 01:00:02:00 01:00:03:00",
      "004  CAM_D V C 00:00:60:00 00:00:01:00 01:00:03:00 01:00:04:00",
    ].join("\n"));
    const validation = validateCmx3600Edl(parsed, 24);

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("duplicated");
    expect(validation.errors.join(" ")).toContain("non-positive source");
    expect(validation.errors.join(" ")).toContain("overlaps");
    expect(validation.errors.join(" ")).toContain("Invalid timecode fields");
    expect(validation.warnings.join(" ")).toContain("record gap");

    expect(validateCmx3600Edl(parseCmx3600Edl(BASE_EDL), 24)).toMatchObject({
      valid: true,
      totalRecordFrames: 48,
    });
    expect(validateCmx3600Edl(parseCmx3600Edl("001 malformed"), 24)).toMatchObject({
      valid: false,
      errors: ["No CMX 3600 event records were found"],
      warnings: ["1 numeric line(s) did not match the supported CMX 3600 event grammar"],
      totalRecordFrames: null,
    });
  });

  it("compares event additions, removals, and edits without mutating either EDL", () => {
    const before = parseCmx3600Edl(BASE_EDL);
    const after = parseCmx3600Edl([
      "001  CAM_A    V     C        00:00:00:00 00:00:01:00 01:00:00:00 01:00:01:00",
      "002  CAM_B    V     D 012    00:00:01:00 00:00:02:00 01:00:01:00 01:00:02:00",
      "004  CAM_D    A     C        00:00:02:00 00:00:03:00 01:00:02:00 01:00:03:00",
    ].join("\n"));

    expect(compareCmx3600Edls(before, after)).toEqual({
      beforeEventCount: 2,
      afterEventCount: 3,
      changes: [
        { eventNumber: 2, type: "changed" },
        { eventNumber: 4, type: "added" },
      ],
      truncated: false,
    });
  });
});

describe("FCPXML inspection and approved-root reference verification", () => {
  it("inspects text only, reports entities defensively, and keeps FCPXML facts bounded", () => {
    const report = inspectFcpxml([
      "<!DOCTYPE fcpxml [<!ENTITY media SYSTEM 'untrusted'>]>",
      "<fcpxml version=\"1.10\"><resources>",
      "<asset id=\"r1\" name=\"Camera\" src=\"file:///safe.mov\" />",
      "<asset id=\"r2\" name=\"Generator\" />",
      "</resources><library><event><project><sequence><spine>",
      "<asset-clip ref=\"r1\" /><video /><audio />",
      "</spine></sequence></project></event></library></fcpxml>",
    ].join(""));

    expect(report).toMatchObject({
      format: "FCPXML",
      version: "1.10",
      sequenceCount: 1,
      clipElementCount: 3,
      assetCount: 2,
      assets: [
        { id: "r1", name: "Camera", source: "file:///safe.mov" },
        { id: "r2", name: "Generator", source: null },
      ],
      warnings: ["DOCTYPE is present; this tool inspects text only and never resolves entities"],
    });
    expect(inspectFcpxml("<sequence />").warnings).toContain("No <fcpxml> root element was found");
  });

  it("verifies only file URLs inside caller-approved roots and hides denied paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "premiere-interchange-root-"));
    const allowedMedia = join(root, "media.mov");
    writeFileSync(allowedMedia, "media");
    const nested = join(root, "nested");
    mkdirSync(nested);
    const missingMedia = join(nested, "missing.mov");
    const outsideMedia = writeFixture("private.mov", "not for inspection");
    const fcpxml = writeFixture("roundtrip.fcpxml", [
      "<fcpxml version=\"1.10\"><resources>",
      `<asset id=\"r1\" name=\"inside\" src=\"${pathToFileURL(allowedMedia)}\" />`,
      `<asset id=\"r2\" name=\"missing\" src=\"${pathToFileURL(missingMedia)}\" />`,
      `<asset id=\"r3\" name=\"outside\" src=\"${pathToFileURL(outsideMedia)}\" />`,
      "<asset id=\"r4\" name=\"remote\" src=\"https://example.test/media.mov\" />",
      "<asset id=\"r5\" name=\"unset\" /></resources></fcpxml>",
    ].join(""));

    const result = await tools.verify_fcpxml_media_references.handler({ path: fcpxml, allowed_roots: [root] });
    expect(result).toMatchObject({
      success: true,
      data: {
        checkedReferenceCount: 5,
        references: [
          { assetId: "r1", status: "available", path: allowedMedia },
          { assetId: "r2", status: "missing", path: missingMedia },
          { assetId: "r3", status: "outside_allowed_roots" },
          { assetId: "r4", status: "non_file_url" },
          { assetId: "r5", status: "missing_source" },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(outsideMedia);
  });
});

describe("interchange tool contracts", () => {
  it("returns parsed, validated, compared, and inspected local results", async () => {
    const beforePath = writeFixture("before.edl", BASE_EDL);
    const afterPath = writeFixture("after.edl", BASE_EDL.replace("CAM_B", "CAM_C"));
    const xmlPath = writeFixture("before.xml", "<fcpxml version=\"1.8\"><sequence /></fcpxml>");

    await expect(tools.inspect_cmx3600_edl.handler({ path: beforePath })).resolves.toMatchObject({ success: true, data: { eventCount: 2 } });
    await expect(tools.validate_cmx3600_edl.handler({ path: beforePath, frame_rate: 24 })).resolves.toMatchObject({ success: true, data: { valid: true } });
    await expect(tools.compare_cmx3600_edls.handler({ before_path: beforePath, after_path: afterPath })).resolves.toMatchObject({ success: true, data: { changes: [{ eventNumber: 2, type: "changed" }] } });
    await expect(tools.inspect_fcpxml_interchange.handler({ path: xmlPath })).resolves.toMatchObject({ success: true, data: { version: "1.8" } });
  });

  it("fails closed for invalid rates, unsafe roots, missing paths, and incorrect extensions", async () => {
    const textPath = writeFixture("not-interchange.txt", "not interchange");
    await expect(tools.inspect_cmx3600_edl.handler({ path: "missing.edl" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("does not exist") });
    await expect(tools.inspect_cmx3600_edl.handler({ path: textPath })).resolves.toMatchObject({ success: false, error: expect.stringContaining(".edl") });
    await expect(tools.validate_cmx3600_edl.handler({ path: "missing.edl", frame_rate: 23 as never })).resolves.toEqual({ success: false, error: "frame_rate must be 24, 25, 29.97, 30, 50, 59.94, or 60" });
    await expect(tools.compare_cmx3600_edls.handler({ before_path: textPath, after_path: textPath })).resolves.toMatchObject({ success: false, error: expect.stringContaining(".edl") });
    await expect(tools.inspect_fcpxml_interchange.handler({ path: textPath })).resolves.toMatchObject({ success: false, error: expect.stringContaining(".fcpxml") });
    await expect(tools.verify_fcpxml_media_references.handler({ path: textPath, allowed_roots: [] })).resolves.toMatchObject({ success: false, error: expect.stringContaining(".fcpxml") });

    const xmlPath = writeFixture("empty.fcpxml", "<fcpxml />");
    await expect(tools.verify_fcpxml_media_references.handler({ path: xmlPath, allowed_roots: ["relative-root"] })).resolves.toMatchObject({ success: false, error: expect.stringContaining("absolute directory") });
    await expect(tools.verify_fcpxml_media_references.handler({ path: xmlPath, allowed_roots: [join(tmpdir(), "missing-root")] })).resolves.toMatchObject({ success: false, error: expect.stringContaining("not an existing directory") });
  });
});
