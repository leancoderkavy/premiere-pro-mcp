import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPublishedVersion } from "./helpers/published-version.js";

/**
 * Plugin launch configurations run an exact published npm version, while their
 * bundled skills teach tool names from the source tree. A skill can therefore
 * advertise a tool the pinned package does not ship. These checks compare both
 * launch pins with a tool snapshot taken from the real registry tarball
 * (tests/fixtures/published-tool-catalog.json). After changing the pins, run
 * `node scripts/snapshot-published-tool-catalog.mjs` to refresh the snapshot.
 */

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

interface PublishedToolCatalog {
  package: string;
  version: string;
  integrity: string;
  gitHead: string;
  source: string;
  tools: string[];
}

const published = readJson("tests/fixtures/published-tool-catalog.json") as PublishedToolCatalog;
const publishedTools = new Set(published.tools);

function catalogToolNames(markdown: string): Set<string> {
  return new Set([...markdown.matchAll(/^\| `([a-z][a-z0-9_]*)` \|/gm)].map((match) => match[1]));
}

const sourceTools = catalogToolNames(read("docs/supported-actions.md"));

const distributions = [
  { name: "Codex", dir: "plugins/premiere-pro" },
  { name: "Claude Code", dir: "claude-plugins/premiere-pro" },
] as const;

function launchPin(dir: string): string {
  const mcp = readJson(`${dir}/.mcp.json`);
  const args: string[] = mcp.mcpServers["premiere-pro"].args;
  const specs = args.filter((arg) => arg.startsWith("premiere-pro-mcp@"));
  expect(specs, `${dir}/.mcp.json must pin exactly one premiere-pro-mcp version`).toHaveLength(1);
  const version = specs[0].slice("premiere-pro-mcp@".length);
  expect(version, `${dir}/.mcp.json must pin an exact SemVer`).toMatch(/^\d+\.\d+\.\d+$/);
  return version;
}

/** Tool names a skill teaches: backticked identifiers that are registered MCP tools. */
function taughtTools(skill: string, known: ReadonlySet<string> = new Set([...sourceTools, ...publishedTools])): string[] {
  const identifiers = new Set(
    [...skill.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((match) => match[1]),
  );
  return [...identifiers].filter((name) => known.has(name)).sort();
}

describe("published tool catalog snapshot", () => {
  it("records a real registry tarball for the README latest release", () => {
    expect(published.package).toBe("premiere-pro-mcp");
    expect(published.version).toBe(readPublishedVersion());
    expect(published.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    expect(published.gitHead).toMatch(/^[0-9a-f]{40}$/);
    expect(published.source).toContain("npm registry tarball");
    expect(published.tools.length).toBeGreaterThan(0);
    expect([...published.tools].sort()).toEqual(published.tools);
    expect(publishedTools.size).toBe(published.tools.length);
  });
});

describe.each(distributions)("$name plugin launch pin", ({ dir }) => {
  const skill = read(`${dir}/skills/edit-premiere-project/SKILL.md`);
  const taught = taughtTools(skill);

  it("pins the version captured in the published tool snapshot", () => {
    expect(launchPin(dir)).toBe(published.version);
  });

  it("ships every tool its bundled editing skill teaches", () => {
    const missing = taught.filter((name) => !publishedTools.has(name));
    expect(
      missing,
      `${dir}/skills/edit-premiere-project/SKILL.md teaches tools that premiere-pro-mcp@${published.version} does not ship`,
    ).toEqual([]);
  });

  it("covers the caption workflow the skill advertises", () => {
    expect(taught).toEqual(
      expect.arrayContaining([
        "add_caption_graphics",
        "check_captions",
        "create_caption_track",
        "get_caption_style_guidance",
        "plan_captions",
        "plan_reaction_captions",
        "read_sequence_captions",
        "retime_caption_file",
        "transcribe_audio",
      ]),
    );
  });
});

describe("launch pin capability check", () => {
  it("flags a skill tool that the pinned package does not ship", () => {
    const unreleased = "unreleased_tool_probe";
    expect(publishedTools.has(unreleased)).toBe(false);
    const skill = `Call \`ping\`, then \`${unreleased}\`; see \`premiere://project/metadata\`.`;
    const taught = taughtTools(skill, new Set([...sourceTools, unreleased]));
    expect(taught).toEqual(["ping", unreleased].sort());
    expect(taught.filter((name) => !publishedTools.has(name))).toEqual([unreleased]);
  });
});
