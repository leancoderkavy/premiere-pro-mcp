import { describe, expect, it } from "vitest";
import { collectCompetitiveScorecard } from "../scripts/competitive-scorecard.mjs";

const now = () => new Date("2026-09-09T08:00:00Z");
function publicApi(options: { failGithub?: boolean; mismatchedWindow?: boolean; wrongIdentity?: boolean; missingStars?: boolean; incompleteSearch?: boolean; missingSearchEntry?: boolean } = {}) {
  return async (url: string) => {
    const ours = !url.includes("hetpatel") && !url.includes("last-week/adobe-");
    if (url.includes("/search/repositories")) return { ok: true, json: async () => ({
      incomplete_results: options.incompleteSearch ?? false,
      total_count: 47,
      items: [
        { full_name: "hetpatel-11/Adobe_Premiere_Pro_MCP" },
        ...(options.missingSearchEntry ? [] : [{ full_name: "leancoderkavy/premiere-pro-mcp" }]),
      ],
    }) };
    if (url.includes("api.github.com")) {
      if (options.failGithub) return { ok: false, status: 403 };
      return { ok: true, json: async () => ({
        full_name: options.wrongIdentity ? "someone/else" : ours ? "leancoderkavy/premiere-pro-mcp" : "hetpatel-11/Adobe_Premiere_Pro_MCP",
        stargazers_count: options.missingStars ? undefined : ours ? 240 : 529,
        forks_count: ours ? 39 : 110,
      }) };
    }
    return { ok: true, json: async () => ({
      package: ours ? "premiere-pro-mcp" : "adobe-premiere-pro-mcp",
      downloads: ours ? 1897 : 1123, start: "2026-08-31",
      end: options.mismatchedWindow && !ours ? "2026-09-05" : "2026-09-06",
    }) };
  };
}

describe("competitive measurement boundaries", () => {
  it("requires one more star than the competitor and compares equal npm windows", async () => {
    const snapshot = await collectCompetitiveScorecard({ fetcher: publicApi(), now });
    expect(snapshot.comparison).toEqual({ starsToLead: 290, starLead: -289, npmDownloadLead: 774, npmWindowsComparable: true });
    expect(snapshot.search.google.position).toBeNull();
    expect(snapshot.search.github.positions.map((row) => row.position)).toEqual([2, 1]);
    expect(snapshot.workflowSuccess.licensedHostRuns).toBeNull();
  });

  it.each([{ failGithub: true }, { wrongIdentity: true }, { missingStars: true }])("preserves unknown counts instead of inventing zeroes: %j", async (options) => {
    const snapshot = await collectCompetitiveScorecard({ fetcher: publicApi(options), now });
    expect(snapshot.projects[0].github.stars).toBeNull();
    expect(snapshot.comparison.starsToLead).toBeNull();
    expect(snapshot.comparison.starLead).toBeNull();
  });

  it("does not compare downloads from unequal date ranges", async () => {
    const snapshot = await collectCompetitiveScorecard({ fetcher: publicApi({ mismatchedWindow: true }), now });
    expect(snapshot.comparison.npmWindowsComparable).toBe(false);
    expect(snapshot.comparison.npmDownloadLead).toBeNull();
  });

  it("withholds all positions when GitHub reports an incomplete search", async () => {
    const snapshot = await collectCompetitiveScorecard({ fetcher: publicApi({ incompleteSearch: true }), now });
    expect(snapshot.search.github.state).toBe("unavailable");
    expect(snapshot.search.github.positions.every((row) => row.position === null)).toBe(true);
  });

  it("does not invent a rank for a repository outside the returned sample", async () => {
    const snapshot = await collectCompetitiveScorecard({ fetcher: publicApi({ missingSearchEntry: true }), now });
    expect(snapshot.search.github.positions[0]).toMatchObject({ position: null, state: "not_in_returned_results" });
    expect(snapshot.search.github.positions[1].position).toBe(1);
  });

  it("keeps network failures separate from measurements without leaking exception text", async () => {
    const snapshot = await collectCompetitiveScorecard({ fetcher: async () => { throw new Error("private diagnostics"); }, now });
    expect(snapshot.projects[0].npm.state).toBe("unavailable");
    expect(snapshot.projects[0].npm.downloads).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("private diagnostics");
  });
});
