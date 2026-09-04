import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import kits from "../landing/lib/workflow-kits.json";
import published from "../landing/lib/published-release.json";
import source from "../release-metadata.json";
import { product } from "../landing/lib/product.js";

// Read our trusted, generated ZIP's local entries without adding a runtime dependency.
function fixtureFiles() {
  const zip = readFileSync("landing/public/downloads/premiere-workflow-starter-kit.zip");
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    expect(zip.readUInt16LE(offset + 6) & 8).toBe(0);
    const method = zip.readUInt16LE(offset + 8);
    const length = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    expect(method).toBe(8);
    expect(name).not.toMatch(/[\\/]|\.\./);
    expect(files.has(name)).toBe(false);
    files.set(name, inflateRawSync(zip.subarray(start, start + length)));
    offset = start + length;
  }
  return files;
}

describe("workflow launch contracts", () => {
  it("keeps release downloads and development counts in separate evidence scopes", () => {
    const facts = JSON.parse(readFileSync("landing/public/marketing-facts.json", "utf8"));
    expect(facts.publishedRelease).toEqual(published);
    expect(facts.developmentSource.coreTools).toBe(source.coreTools);
    expect(facts.developmentSource.evidenceScope).toBe("source_catalog_may_include_unreleased_work");
    expect(product.coreToolCount).toBe(facts.publishedRelease.coreTools);
    expect(published.defaultProfileTools + published.uxpAdditionalTools).toBe(published.defaultProfileWithUxpTools);
    expect(published.provenance.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(published.provenance.integrity).toMatch(/^sha512-/);
    expect(facts.hostVerification).toBe("not_established_by_catalogs");
  });

  it("ships the same prompts in the ZIP and website, with verifiable synthetic media", () => {
    const files = fixtureFiles();
    expect([...files.keys()].sort()).toEqual(["LICENSE", "README.md", "blue.mp4", "evaluation-recipes.json", "fixture-manifest.json", "sample-captions.srt", "violet.mp4"].sort());
    expect(JSON.parse(files.get("evaluation-recipes.json")!.toString())).toEqual(kits);
    const manifest = JSON.parse(files.get("fixture-manifest.json")!.toString());
    expect(manifest.premiereHostValidation).toBe("not_run");
    expect(manifest.nativePremiereProjectIncluded).toBe(false);
    for (const item of manifest.media) {
      expect(createHash("sha256").update(files.get(item.file)!).digest("hex")).toBe(item.sha256);
      expect(files.get(item.file)!.subarray(4, 8).toString()).toBe("ftyp");
    }
  });

  it("does not turn a starter prompt into an unattended mutation", () => {
    expect(kits.find((kit) => kit.id === "project-check")!.prompt).toContain("or change Premiere");
    expect(kits.find((kit) => kit.id === "review-frames")!.prompt).toContain("wait for my confirmation before writing files");
    expect(kits.find((kit) => kit.id === "product-spot")!.prompt).toContain("Do not apply, render, upload, or export anything");
    const catalog = readFileSync("docs/supported-actions.md", "utf8");
    for (const kit of kits) for (const tool of kit.tools) expect(catalog).toContain(`\`${tool}\``);
  });
});
