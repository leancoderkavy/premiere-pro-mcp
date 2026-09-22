import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsPath, trackOnboardingEvent } from "../landing/lib/onboarding-events.js";

const script = readFileSync("landing/public/analytics.js", "utf8");

function load(privacy: { globalPrivacyControl?: boolean } = {}, host = "https://us.i.posthog.com") {
  const tags: Array<{ src: string; onload: () => void }> = [];
  let config: Record<string, any> = {};
  const capture = vi.fn();
  const window = {
    location: { pathname: "/", search: "?token=secret" },
    requestIdleCallback: (callback: () => void) => callback(),
    posthog: { capture, init: vi.fn((_token, options) => { config = options; }) },
    __premierePosthogQueue: [{ eventName: "onboarding_copy_failed", properties: { surface: "website", action: "safe_prompt" } }],
  };
  const document = {
    currentScript: { dataset: { posthogProjectToken: "phc_test", posthogHost: host } },
    createElement: () => ({}),
    head: { appendChild: (tag: (typeof tags)[number]) => tags.push(tag) },
  };
  runInNewContext(script, { window, document, navigator: privacy, URLSearchParams });
  return { tags, window, capture, config: () => config };
}

afterEach(() => vi.unstubAllGlobals());

describe("PostHog capture privacy boundaries", () => {
  it.each(["https://us.i.posthog.com", "https://eu.i.posthog.com"])("loads %s and flushes early events once", (host) => {
    const fixture = load({}, host);
    expect(fixture.tags).toHaveLength(1);
    fixture.tags[0].onload();
    const config = fixture.config();
    expect(config.api_host).toBe(host);
    expect(config.person_profiles).toBe("never");
    expect(config.capture_exceptions).toBe(false);
    config.loaded(fixture.window.posthog);
    config.loaded(fixture.window.posthog);
    expect(fixture.capture).toHaveBeenCalledExactlyOnceWith("onboarding_copy_failed", { surface: "website", action: "safe_prompt" });
  });

  it("drops SDK-enriched sensitive data while retaining ingestion IDs and bounded actions", () => {
    const fixture = load();
    fixture.tags[0].onload();
    const result = fixture.config().before_send({ event: "onboarding_copy_failed", properties: {
      token: "phc_public_project", distinct_id: "anonymous", $session_id: "session",
      surface: "website", action: "safe_prompt", path: "/docs", utm_source: "newsletter",
      $current_url: "https://example.com/?token=secret#editor@example.com",
      $referrer: "https://example.com/private.mov", $initial_current_url: "secret",
      $set: { email: "editor@example.com" }, $set_once: { private: "secret" },
      $pathname: "/private.mov", $exception_list: [{ value: "secret" }], gclid: "secret",
      prompt: "private editing instructions", $process_person_profile: true,
      utm_campaign: "editor@example.com", $ip: "192.0.2.1",
    } });
    expect(result.properties).toEqual({
      token: "phc_public_project", distinct_id: "anonymous", $session_id: "session",
      surface: "website", action: "safe_prompt", path: "/docs", utm_source: "newsletter",
      $process_person_profile: false,
      $ip: "0", $geoip_disable: true,
    });
    expect(fixture.config().before_send({ event: "$exception", properties: {} })).toBeNull();
  });

  it("rechecks privacy after the SDK download and before every send", () => {
    const privacy = { globalPrivacyControl: false };
    const fixture = load(privacy);
    privacy.globalPrivacyControl = true;
    fixture.tags[0].onload();
    expect(fixture.window.posthog.init).not.toHaveBeenCalled();
    privacy.globalPrivacyControl = false;
    fixture.tags[0].onload();
    privacy.globalPrivacyControl = true;
    expect(fixture.config().before_send({ properties: { surface: "website" } })).toBeNull();
  });

  it("rejects an unsupported ingestion host", () => {
    expect(load({}, "https://untrusted.example").tags).toHaveLength(0);
  });

  it("redacts arbitrary route paths and blog slugs", () => {
    expect(analyticsPath("/docs/")).toBe("/docs");
    expect(analyticsPath("/")).toBe("/");
    expect(analyticsPath("/blog/editor@example.com")).toBe("/blog/[slug]");
    expect(analyticsPath("/Users/editor/private.mov")).toBe("/other");
  });

  it("queues copy failures without clipboard contents or exception details and honors GPC", () => {
    const browser = {
      location: { pathname: "/private.mov", search: "?token=secret&utm_source=newsletter" },
      sessionStorage: { getItem: () => null, setItem: vi.fn() },
      dispatchEvent: vi.fn(),
      __premierePosthogQueue: [] as unknown[],
    };
    vi.stubGlobal("window", browser);
    vi.stubGlobal("navigator", { globalPrivacyControl: false });
    trackOnboardingEvent("onboarding_copy_failed", { action: "install_command" });
    expect(browser.__premierePosthogQueue).toHaveLength(1);
    expect(browser.__premierePosthogQueue[0]).toMatchObject({
      eventName: "onboarding_copy_failed", properties: { action: "install_command", path: "/other" },
    });
    expect(JSON.stringify(browser.__premierePosthogQueue)).not.toMatch(/secret|private\.mov|clipboard|exception/);
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    trackOnboardingEvent("onboarding_copy_failed", { action: "safe_prompt" });
    expect(browser.__premierePosthogQueue).toHaveLength(1);
  });
});
