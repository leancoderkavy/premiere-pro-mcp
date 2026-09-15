import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("landing PostHog analytics", () => {
  it("defers PostHog behind the first-party loader with privacy-safe options", () => {
    const loader = read("landing/public/analytics.js");
    const layout = read("landing/app/layout.tsx");
    const events = read("landing/lib/onboarding-events.ts");

    expect(layout).toContain("data-posthog-project-token={posthogProjectToken}");
    expect(layout).toContain("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN");
    expect(loader).toContain('"https://us-assets.i.posthog.com"');
    expect(loader).toContain("posthogHosts[posthogHost]");
    expect(loader).toContain("autocapture: false");
    expect(loader).toContain("capture_pageview: false");
    expect(loader).toContain("disable_session_recording: true");
    expect(loader).toContain('person_profiles: "identified_only"');
    expect(loader).toContain("advanced_disable_flags: true");
    expect(loader).toContain("analyticsPermitted");
    expect(events).toContain('surface: "website"');
    expect(events).toContain("$process_person_profile: false");
    expect(events).toContain('capturePosthogEvent("$pageview"');
    expect(events).not.toMatch(/identify\(/);
    expect(read("landing/app/privacy/page.tsx")).toContain(
      "PostHog is configured without autocapture, session replay, or person profiles",
    );
  });

  it("keeps website analytics off the MCP server identity contract", () => {
    const events = read("landing/lib/onboarding-events.ts");
    const telemetry = read("src/telemetry.ts");

    expect(events).toContain('surface: "website"');
    expect(events).not.toContain("FLY_MACHINE_ID");
    expect(telemetry).toContain('service: "premiere-pro-mcp"');
    expect(telemetry).toContain("$process_person_profile: false");
  });
});
