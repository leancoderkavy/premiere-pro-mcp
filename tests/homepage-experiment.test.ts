import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOMEPAGE_FLAG,
  HomepageExperiment,
  type HomepageAnalytics,
} from "../src/homepage-experiment.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  vi.restoreAllMocks();
});

async function fixture(
  evaluate: HomepageAnalytics["evaluate"] = async () => "test",
  enabled = true,
) {
  const capture = vi.fn();
  const evaluator = vi.fn(evaluate);
  const experiment = new HomepageExperiment(
    { evaluate: evaluator, capture, shutdown: async () => {} },
    "test-secret-for-homepage-experiments-only",
    enabled,
  );
  const server = http.createServer(async (req, res) => {
    if (req.url === "/event") await experiment.handleEvent(req, res);
    else {
      const variant = await experiment.assign(req, res);
      res.end(variant ?? "fallback");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 Chrome/140",
    "Content-Type": "application/json",
    Origin: url,
    "Sec-Fetch-Site": "same-origin",
  };
  const get = (extra: Record<string, string> = {}) =>
    fetch(url, { headers: { ...headers, ...extra } });
  const post = (
    cookie: string,
    body: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${url}/event`, {
      method: "POST",
      headers: { ...headers, Cookie: cookie, ...extra },
      body: JSON.stringify(body),
    });
  const cookie = (response: Response) =>
    response.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { get, post, capture, evaluator, cookie };
}

describe("homepage experiment assignment and exposure", () => {
  it("revokes stale enrollment on a flag outage while preserving visitor identity", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const f = await fixture(async () => "control");
    const assigned = f.cookie(await f.get());
    f.evaluator.mockResolvedValueOnce(false);
    now += 61_000;
    const fallback = await f.get({ Cookie: assigned });
    expect(await fallback.text()).toBe("fallback");
    const inactive = f.cookie(fallback);
    await f.post(inactive, { event: "homepage_experiment_exposed", variant: "control" });
    await f.post(inactive, { event: "onboarding_safe_prompt_copied", variant: "control" });
    expect(f.capture).not.toHaveBeenCalled();
    now += 61_000;
    expect(await (await f.get({ Cookie: inactive })).text()).toBe("control");
    expect(new Set(f.evaluator.mock.calls.map(([id]) => id)).size).toBe(1);
  });
  it("keeps the anonymous assignment stable and records no exposure during evaluation", async () => {
    const f = await fixture();
    const first = await f.get();
    expect(await first.text()).toBe("test");
    expect(first.headers.get("set-cookie")).toContain(
      "HttpOnly; Secure; SameSite=Lax",
    );
    const second = await f.get({ Cookie: f.cookie(first) });
    expect(await second.text()).toBe("test");
    expect(f.evaluator).toHaveBeenCalledTimes(1);
    expect(f.capture).not.toHaveBeenCalled();
  });

  it.each([
    { DNT: "1" },
    { DNT: "yes" },
    { "Sec-GPC": "1" },
    { "User-Agent": "Googlebot" },
    { "User-Agent": "HeadlessChrome" },
  ])(
    "does not assign or identify opted-out or automated traffic: %j",
    async (headers) => {
      const f = await fixture();
      const response = await f.get(headers);
      expect(await response.text()).toBe("fallback");
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(f.evaluator).not.toHaveBeenCalled();
    },
  );

  it.each([false, undefined, "unexpected"])(
    "falls back without enrollment for an inactive or unknown flag: %s",
    async (value) => {
      const f = await fixture(async () => value);
      const response = await f.get();
      expect(await response.text()).toBe("fallback");
      expect(response.headers.has("set-cookie")).toBe(false);
    },
  );

  it("bounds provider delays and tolerates errors", async () => {
    const f = await fixture(() => new Promise(() => {}));
    const started = performance.now();
    expect(await (await f.get()).text()).toBe("fallback");
    expect(performance.now() - started).toBeLessThan(1000);
    const broken = await fixture(async () => {
      throw new Error("offline");
    });
    expect(await (await broken.get()).text()).toBe("fallback");
  });

  it("records the rendered variant, then a download conversion under the same visitor", async () => {
    const f = await fixture();
    const assigned = f.cookie(await f.get());
    const early = await f.post(assigned, {
      event: "onboarding_download_started",
      variant: "test",
      parameters: { route: "claude" },
    });
    expect(early.status).toBe(409);
    const exposure = await f.post(assigned, {
      event: "homepage_experiment_exposed",
      variant: "test",
    });
    expect(exposure.status).toBe(204);
    const enrolled = f.cookie(exposure);
    expect(
      (
        await f.post(enrolled, {
          event: "onboarding_download_started",
          variant: "test",
          parameters: {
            route: "claude",
            prompt: "private footage",
            project: "secret",
          },
        })
      ).status,
    ).toBe(204);
    const calls = f.capture.mock.calls;
    expect(calls.map((call) => call[1])).toEqual([
      "$feature_flag_called",
      "onboarding_download_started",
      "homepage_setup_downloaded",
    ]);
    expect(new Set(calls.map((call) => call[0])).size).toBe(1);
    expect(calls[0][2]).toMatchObject({
      $feature_flag: HOMEPAGE_FLAG,
      $feature_flag_response: "test",
      $process_person_profile: false,
    });
    expect(JSON.stringify(calls)).not.toMatch(
      /private footage|secret|prompt|project/,
    );
    await f.post(enrolled, {
      event: "homepage_experiment_exposed",
      variant: "test",
    });
    expect(f.capture).toHaveBeenCalledTimes(3);
  });

  it("does not mistake guided setup links for downloads", async () => {
    const f = await fixture(async () => "control");
    const first = f.cookie(await f.get());
    const enrolled = f.cookie(
      await f.post(first, {
        event: "homepage_experiment_exposed",
        variant: "control",
      }),
    );
    await f.post(enrolled, {
      event: "onboarding_download_started",
      variant: "control",
      parameters: { route: "cursor" },
    });
    expect(f.capture.mock.calls.map((call) => call[1])).not.toContain(
      "homepage_setup_downloaded",
    );
    await f.post(enrolled, {
      event: "onboarding_safe_prompt_copied",
      variant: "control",
    });
    expect(f.capture.mock.calls.map((call) => call[1])).toContain(
      "homepage_safe_prompt_copied",
    );
  });

  it("rejects wrong variants, tampering, cross-origin requests, and oversized bodies", async () => {
    const f = await fixture();
    const assigned = f.cookie(await f.get());
    const body = { event: "homepage_experiment_exposed", variant: "test" };
    expect(
      (await f.post(assigned, { ...body, variant: "control" })).status,
    ).toBe(400);
    expect(
      (await f.post(assigned, body, { Origin: "https://elsewhere.example" }))
        .status,
    ).toBe(403);
    expect(
      (await f.post(assigned.replace(".test.", ".control."), body)).status,
    ).toBe(204);
    expect(
      (await f.post(assigned, { ...body, junk: "x".repeat(2000) })).status,
    ).toBe(413);
    expect((await f.post(assigned, body, { "Sec-GPC": "1" })).status).toBe(204);
    expect(f.capture).not.toHaveBeenCalled();
  });

  it("does not contact PostHog when disabled", async () => {
    const f = await fixture(async () => "test", false);
    expect(await (await f.get()).text()).toBe("fallback");
    expect(f.evaluator).not.toHaveBeenCalled();
  });
});
