import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import { PostHog } from "posthog-node";
import {
  readBoundedRequestBody,
  RequestBodyTooLargeError,
} from "./http-admission.js";

export const HOMEPAGE_FLAG = "homepage-cinematic-2026";
const COOKIE = "premiere_homepage_v1";
const MAX_AGE = 60 * 60 * 24 * 30;
const PARAMETER_VALUES: Record<string, readonly string[]> = {
  route: ["claude", "codex", "cursor", "vscode", "other", "cep_connector"],
  assistant: ["claude", "codex", "cursor", "vscode", "other"],
  location: ["hero", "navigation", "final_cta", "final-cta", "install", "demo"],
  destination: [
    "safe_connection_check",
    "workflow_starter_kit",
    "github",
    "claude",
    "codex",
    "cursor",
    "vscode",
    "other",
  ],
  demo: ["illustrated_workflow"],
};
export type HomepageVariant = "control" | "test";
type Assignment = {
  id: string;
  variant: HomepageVariant;
  issued: number;
  exposed: boolean;
  eligible: boolean;
};
type Properties = Record<string, string | number | boolean>;

export interface HomepageAnalytics {
  evaluate(id: string): Promise<unknown>;
  capture(id: string, event: string, properties: Properties): void;
  shutdown(): Promise<void>;
}

export function homepageAnalyticsPermitted(
  req: Pick<http.IncomingMessage, "headers">,
): boolean {
  return (
    req.headers.dnt !== "1" &&
    req.headers.dnt !== "yes" &&
    req.headers["sec-gpc"] !== "1" &&
    !/bot|crawl|spider|headless|preview|lighthouse/i.test(
      String(req.headers["user-agent"] ?? ""),
    )
  );
}

/** Isolated from MCP telemetry: each visitor gets an anonymous identity. */
export class HomepageExperiment {
  private readonly decisions = new Map<
    string,
    { value: HomepageVariant | null; until: number }
  >();
  private readonly eventCounts = new Map<
    string,
    { count: number; until: number }
  >();
  private evaluations = 0;

  constructor(
    private readonly client: HomepageAnalytics | undefined,
    private readonly secret: string,
    private readonly enabled: boolean,
  ) {}

  private get active() {
    return this.enabled && this.secret.length >= 32 && Boolean(this.client);
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret)
      .update(payload)
      .digest("base64url");
  }

  private read(req: http.IncomingMessage): Assignment | undefined {
    const token = String(req.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!token || token.length > 220) return;
    const [id, variant, issuedText, exposed, signature, extra] =
      token.split(".");
    if (
      extra ||
      !/^[0-9a-f-]{36}$/.test(id ?? "") ||
      !["control", "test"].includes(variant) ||
      !/^[012]$/.test(exposed ?? "") ||
      !/^[A-Za-z0-9_-]{43}$/.test(signature ?? "")
    )
      return;
    const issued = Number(issuedText);
    if (
      !Number.isSafeInteger(issued) ||
      issued > Date.now() + 30_000 ||
      Date.now() - issued > MAX_AGE * 1000
    )
      return;
    const expected = Buffer.from(
      this.sign(`${id}.${variant}.${issuedText}.${exposed}`),
    );
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return;
    return {
      id,
      variant: variant as HomepageVariant,
      issued,
      exposed: exposed === "1",
      eligible: exposed !== "2",
    };
  }

  private cookie(res: http.ServerResponse, assignment: Assignment) {
    const payload = `${assignment.id}.${assignment.variant}.${assignment.issued}.${assignment.eligible ? (assignment.exposed ? "1" : "0") : "2"}`;
    // __Secure- cannot be used because the same server is also a localhost preview.
    // Production browsers always receive Secure; localhost is allowed by browsers.
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${payload}.${this.sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`,
    );
  }

  async assign(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<HomepageVariant | undefined> {
    if (
      !this.active ||
      !homepageAnalyticsPermitted(req) ||
      req.method !== "GET"
    )
      return;
    const prior = this.read(req);
    const fallback = () => {
      // Preserve identity across a transient flag outage while revoking the
      // previous page's enrollment. A stale control cookie must not manufacture
      // exposure on an unassigned control fallback.
      if (prior) this.cookie(res, { ...prior, eligible: false, issued: Date.now() });
      return undefined;
    };
    const id = prior?.id ?? randomUUID();
    const cached = this.decisions.get(id);
    let variant: HomepageVariant | null = null;
    if (cached && cached.until > Date.now()) variant = cached.value;
    else {
      // The landing page must remain available during provider delays or bursts.
      if (this.evaluations >= 20) return fallback();
      this.evaluations++;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          this.client!.evaluate(id),
          new Promise<undefined>((resolve) => {
            timeout = setTimeout(() => resolve(undefined), 450);
          }),
        ]);
        if (result === "control" || result === "test") variant = result;
      } catch {
        /* Optional experimentation must never prevent a page response. */
      } finally {
        if (timeout) clearTimeout(timeout);
        this.evaluations--;
      }
      if (this.decisions.size >= 5_000)
        this.decisions.delete(this.decisions.keys().next().value!);
      this.decisions.set(id, { value: variant, until: Date.now() + 60_000 });
    }
    if (!variant) return fallback();
    this.cookie(res, { id, variant, issued: Date.now(), exposed: false, eligible: true });
    return variant;
  }

  async handleEvent(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    const end = (status: number) => {
      res.writeHead(status);
      res.end();
    };
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      end(405);
      return;
    }
    const assignment = this.read(req);
    if (!this.active || !assignment?.eligible || !homepageAnalyticsPermitted(req)) {
      end(204);
      return;
    }
    // Require browser same-origin JSON; no public cross-origin event collector.
    const origin = req.headers.origin;
    const allowedOrigins = new Set([
      "https://premiere-pro-mcp.com",
      "https://www.premiere-pro-mcp.com",
      "https://premiere-pro-mcp.fly.dev",
    ]);
    const localHost = String(req.headers.host ?? "");
    if (/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(localHost))
      allowedOrigins.add(`http://${localHost}`);
    if (
      !origin ||
      !allowedOrigins.has(origin) ||
      (req.headers["sec-fetch-site"] &&
        req.headers["sec-fetch-site"] !== "same-origin")
    ) {
      end(403);
      return;
    }
    if (
      !String(req.headers["content-type"] ?? "").startsWith("application/json")
    ) {
      end(415);
      return;
    }
    const existing = this.eventCounts.get(assignment.id);
    const rate =
      existing && existing.until > Date.now()
        ? existing
        : { count: 0, until: Date.now() + 60_000 };
    if (++rate.count > 40) {
      end(429);
      return;
    }
    if (this.eventCounts.size >= 5_000 && !this.eventCounts.has(assignment.id))
      this.eventCounts.delete(this.eventCounts.keys().next().value!);
    this.eventCounts.set(assignment.id, rate);
    try {
      const body = JSON.parse(
        (await readBoundedRequestBody(req, 1024)).toString("utf8"),
      ) as unknown;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        end(400);
        return;
      }
      const input = body as Record<string, unknown>;
      if (
        input.variant !== assignment.variant ||
        typeof input.event !== "string"
      ) {
        end(400);
        return;
      }
      const props: Properties = {
        product: "premiere-pro-mcp",
        path: "/",
        variant: assignment.variant,
        [`$feature/${HOMEPAGE_FLAG}`]: assignment.variant,
        $process_person_profile: false,
        $geoip_disable: true,
      };
      if (input.event === "homepage_experiment_exposed") {
        if (!assignment.exposed)
          this.client!.capture(assignment.id, "$feature_flag_called", {
            ...props,
            $feature_flag: HOMEPAGE_FLAG,
            $feature_flag_response: assignment.variant,
          });
        this.cookie(res, { ...assignment, exposed: true });
        end(204);
        return;
      }
      if (!assignment.exposed) {
        end(409);
        return;
      }
      const allowed = new Set([
        "primary_cta_clicked",
        "onboarding_assistant_selected",
        "onboarding_download_started",
        "onboarding_safe_prompt_copied",
        "onboarding_advanced_opened",
        "onboarding_recovery_opened",
        "marketing_demo_played",
      ]);
      if (!allowed.has(input.event)) {
        end(400);
        return;
      }
      const parameters = input.parameters;
      if (
        parameters &&
        typeof parameters === "object" &&
        !Array.isArray(parameters)
      ) {
        for (const key of [
          "route",
          "assistant",
          "location",
          "destination",
          "demo",
        ]) {
          const value = (parameters as Record<string, unknown>)[key];
          if (
            typeof value === "string" &&
            PARAMETER_VALUES[key].includes(value)
          )
            props[key] = value;
        }
      }
      this.client!.capture(assignment.id, input.event, props);
      if (
        input.event === "onboarding_download_started" &&
        ["claude", "cep_connector"].includes(String(props.route))
      )
        this.client!.capture(assignment.id, "homepage_setup_downloaded", props);
      if (input.event === "onboarding_safe_prompt_copied")
        this.client!.capture(
          assignment.id,
          "homepage_safe_prompt_copied",
          props,
        );
      end(204);
    } catch (error) {
      end(error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
  }

  async shutdown() {
    await this.client?.shutdown();
  }
}

export function createHomepageExperiment(
  env: NodeJS.ProcessEnv = process.env,
): HomepageExperiment {
  let analytics: HomepageAnalytics | undefined;
  if (
    env.HOMEPAGE_EXPERIMENT_ENABLED === "true" &&
    env.POSTHOG_API_KEY &&
    (env.HOMEPAGE_EXPERIMENT_SECRET?.length ?? 0) >= 32
  ) {
    const client = new PostHog(env.POSTHOG_API_KEY, {
      host: env.POSTHOG_HOST ?? "https://us.i.posthog.com",
      flushAt: 1,
      featureFlagsRequestTimeoutMs: 400,
      fetchRetryCount: 0,
      disableGeoip: true,
      sendFeatureFlagEvent: false,
    });
    analytics = {
      // getAllFlags deliberately avoids exposure; rendering is acknowledged separately.
      evaluate: async (id) =>
        (
          await client.getAllFlags(id, {
            flagKeys: [HOMEPAGE_FLAG],
            personProperties: {
              product: "premiere-pro-mcp",
              surface: "homepage",
            },
            disableGeoip: true,
          })
        )[HOMEPAGE_FLAG],
      capture: (distinctId, event, properties) =>
        client.capture({ distinctId, event, properties, disableGeoip: true }),
      shutdown: () => client.shutdown(),
    };
  }
  return new HomepageExperiment(
    analytics,
    env.HOMEPAGE_EXPERIMENT_SECRET ?? "",
    env.HOMEPAGE_EXPERIMENT_ENABLED === "true",
  );
}
