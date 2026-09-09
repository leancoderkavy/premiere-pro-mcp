import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projects = [
  { role: "ours", repository: "leancoderkavy/premiere-pro-mcp", package: "premiere-pro-mcp" },
  { role: "comparison", repository: "hetpatel-11/Adobe_Premiere_Pro_MCP", package: "adobe-premiere-pro-mcp" },
];
const githubSearchQuery = "premiere pro mcp";
const githubSearchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(githubSearchQuery)}&per_page=100&page=1`;
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const date = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
};

async function readPublicJson(url, fetcher) {
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json", "User-Agent": "premiere-pro-mcp-competitive-scorecard" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { state: "unavailable", reason: `http_${response.status}`, source: url, data: null };
    return { state: "observed", source: url, data: await response.json() };
  } catch {
    return { state: "unavailable", reason: "request_failed", source: url, data: null };
  }
}

export async function collectCompetitiveScorecard({ fetcher = fetch, now = () => new Date() } = {}) {
  const [rows, searchSample] = await Promise.all([Promise.all(projects.map(async (project) => {
    const [github, npm] = await Promise.all([
      readPublicJson(`https://api.github.com/repos/${project.repository}`, fetcher),
      readPublicJson(`https://api.npmjs.org/downloads/point/last-week/${project.package}`, fetcher),
    ]);
    const validRepo = typeof github.data?.full_name === "string" && github.data.full_name.toLowerCase() === project.repository.toLowerCase();
    const validPackage = npm.data?.package === project.package;
    return {
      ...project,
      github: {
        state: validRepo ? "observed" : "unavailable",
        source: github.source,
        reason: validRepo ? null : github.reason ?? "unexpected_repository",
        stars: validRepo ? count(github.data.stargazers_count) : null,
        forks: validRepo ? count(github.data.forks_count) : null,
      },
      npm: {
        state: validPackage ? "observed" : "unavailable",
        source: npm.source,
        reason: validPackage ? null : npm.reason ?? "unexpected_package",
        downloads: validPackage ? count(npm.data.downloads) : null,
        start: validPackage ? date(npm.data.start) : null,
        end: validPackage ? date(npm.data.end) : null,
      },
    };
  })), readPublicJson(githubSearchUrl, fetcher)]);
  const completeSearch = searchSample.data?.incomplete_results === false &&
    Array.isArray(searchSample.data?.items) &&
    searchSample.data.items.every((item) => typeof item?.full_name === "string");
  const githubSearch = {
    state: completeSearch ? "observed" : "unavailable",
    reason: completeSearch ? null : searchSample.reason ?? "incomplete_or_invalid_search",
    source: githubSearchUrl,
    query: githubSearchQuery,
    method: "github_rest_best_match_unauthenticated",
    page: 1,
    limit: 100,
    totalCount: count(searchSample.data?.total_count),
    returnedCount: completeSearch ? searchSample.data.items.length : null,
    positions: projects.map(({ role, repository }) => {
      const index = completeSearch ? searchSample.data.items.findIndex((item) => item.full_name.toLowerCase() === repository.toLowerCase()) : -1;
      return {
        role, repository, position: index >= 0 ? index + 1 : null,
        state: !completeSearch ? "unavailable" : index >= 0 ? "observed" : "not_in_returned_results",
      };
    }),
  };
  const [ours, comparison] = rows;
  const starsComparable = ours.github.stars !== null && comparison.github.stars !== null;
  const downloadsComparable = ours.npm.downloads !== null && comparison.npm.downloads !== null &&
    ours.npm.start !== null && ours.npm.end !== null && ours.npm.start <= ours.npm.end &&
    ours.npm.start === comparison.npm.start && ours.npm.end === comparison.npm.end;
  return {
    schemaVersion: "premiere-pro-mcp.competitive-scorecard.v1",
    observedAt: now().toISOString(),
    projects: rows,
    comparison: {
      starsToLead: starsComparable ? Math.max(0, comparison.github.stars + 1 - ours.github.stars) : null,
      starLead: starsComparable ? ours.github.stars - comparison.github.stars : null,
      npmDownloadLead: downloadsComparable ? ours.npm.downloads - comparison.npm.downloads : null,
      npmWindowsComparable: downloadsComparable,
    },
    search: { google: { state: "not_measured", position: null }, github: githubSearch },
    workflowSuccess: { state: "not_measured", licensedHostRuns: null },
    boundaries: [
      "Stars and forks are public repository signals, not active editors or workflow quality.",
      "npm counts include CI, repeat downloads, and automation; they do not establish unique installs or users.",
      "The star target changes when either repository gains or loses stars.",
      "Unknown or failed measurements remain null. Search results require a separately dated query, engine, locale, and method.",
      "GitHub API best-match order is one query sample, not a Google rank, GitHub Trending rank, or personalized browser result. Absence from the returned page is not an inferred position.",
    ],
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--output" || !args[1] || args[1].startsWith("--"))) {
    throw new Error("Usage: node scripts/competitive-scorecard.mjs [--output <new-snapshot.json>]");
  }
  const snapshot = await collectCompetitiveScorecard();
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (args.length) {
    const output = resolve(args[1]);
    await mkdir(dirname(output), { recursive: true });
    // Historical evidence must not be silently overwritten.
    await writeFile(output, json, { flag: "wx" });
  }
  process.stdout.write(json);
  if (snapshot.search.github.state !== "observed" || snapshot.projects.some((row) => row.github.stars === null || row.github.forks === null || row.npm.downloads === null || row.npm.start === null || row.npm.end === null)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("Scorecard failed. Check arguments, network access, and whether the output file already exists; existing snapshots are never replaced.");
    process.exitCode = 1;
  });
}
