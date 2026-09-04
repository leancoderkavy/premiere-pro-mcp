import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type http from "node:http";

export const MCP_HTTP_METHODS = ["GET", "POST", "DELETE"] as const;

export interface HttpAuthConfiguration {
  mode: "shared-token" | "oauth" | "unauthenticated";
  authToken?: string;
  oauth?: {
    issuer: string;
    audience: string;
    publicUrl: string;
    jwksUri: string;
    requiredScopes: string[];
    allowedSubjects: string[];
  };
  allowUnauthenticated: boolean;
}

export interface HttpAdmissionSettings {
  maxRequestBytes: number;
  headersTimeoutMs: number;
  requestTimeoutMs: number;
  keepAliveTimeoutMs: number;
  maxRequestsPerSocket: number;
  maxConcurrentRequests: number;
  maxConcurrentStreams: number;
  rateLimitPerMinute: number;
  rateLimitBurst: number;
  maxRateLimitKeys: number;
  trustProxy: boolean;
}

export interface AdmissionMetrics {
  activeRequests: number;
  activeOperationRequests: number;
  activeStreamRequests: number;
  trackedRateLimitKeys: number;
}

export type AdmissionLane = "operation" | "stream";

export type AdmissionDecision =
  | { accepted: true; release: () => void }
  | { accepted: false; reason: "rate_limited" | "at_capacity"; statusCode: 429 | 503; retryAfterSeconds: number };

const ONE_MINUTE_MS = 60_000;
const RATE_LIMIT_IDENTITY_KEY = randomBytes(32);

function readBoundedInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

/**
 * Reads the public-HTTP containment settings. Invalid values fail startup so a
 * typo cannot silently turn a request or socket bound into an unlimited one.
 */
export function readHttpAdmissionSettings(env: NodeJS.ProcessEnv): HttpAdmissionSettings {
  const rateLimitPerMinute = readBoundedInteger(env, "MCP_RATE_LIMIT_PER_MINUTE", 120, 1, 10_000);
  const rateLimitBurst = readBoundedInteger(env, "MCP_RATE_LIMIT_BURST", 30, 1, rateLimitPerMinute);

  return {
    maxRequestBytes: readBoundedInteger(env, "MCP_MAX_REQUEST_BYTES", 1_048_576, 1_024, 10_485_760),
    headersTimeoutMs: readBoundedInteger(env, "MCP_HEADERS_TIMEOUT_MS", 10_000, 1_000, 60_000),
    requestTimeoutMs: readBoundedInteger(env, "MCP_REQUEST_TIMEOUT_MS", 60_000, 1_000, 300_000),
    keepAliveTimeoutMs: readBoundedInteger(env, "MCP_KEEP_ALIVE_TIMEOUT_MS", 5_000, 1_000, 60_000),
    maxRequestsPerSocket: readBoundedInteger(env, "MCP_MAX_REQUESTS_PER_SOCKET", 100, 1, 10_000),
    maxConcurrentRequests: readBoundedInteger(env, "MCP_MAX_CONCURRENT_REQUESTS", 8, 1, 128),
    maxConcurrentStreams: readBoundedInteger(env, "MCP_MAX_CONCURRENT_STREAMS", 32, 1, 1_024),
    rateLimitPerMinute,
    rateLimitBurst,
    maxRateLimitKeys: readBoundedInteger(env, "MCP_MAX_RATE_LIMIT_KEYS", 2_048, 16, 100_000),
    trustProxy: env.MCP_TRUST_PROXY === "1",
  };
}

/**
 * A network-reachable editor control plane must never start unauthenticated in
 * production. The override remains available only for local development and
 * test harnesses where it does not create a public deployment.
 */
export function readHttpAuthConfiguration(env: NodeJS.ProcessEnv): HttpAuthConfiguration {
  const authToken = env.MCP_AUTH_TOKEN?.trim();
  const oauthIssuer = env.MCP_OAUTH_ISSUER?.trim();
  const oauthAudience = env.MCP_OAUTH_AUDIENCE?.trim();
  const publicUrl = env.MCP_PUBLIC_URL?.trim();
  const oauthJwksUri = env.MCP_OAUTH_JWKS_URI?.trim();
  const oauthRequiredScopes = env.MCP_OAUTH_REQUIRED_SCOPES?.trim();
  const oauthAllowedSubjects = env.MCP_OAUTH_ALLOWED_SUBJECTS?.trim();
  const hasOAuthIntent = Boolean(
    oauthIssuer || oauthAudience || publicUrl || oauthJwksUri || oauthRequiredScopes || oauthAllowedSubjects,
  );

  if (authToken && hasOAuthIntent) {
    throw new Error("Configure either MCP_AUTH_TOKEN or MCP_OAUTH_ISSUER, not both.");
  }

  if (hasOAuthIntent) {
    if (!oauthIssuer || !oauthAudience || !publicUrl || !oauthJwksUri || !oauthAllowedSubjects) {
      throw new Error(
        "MCP_OAUTH_ISSUER, MCP_OAUTH_AUDIENCE, MCP_OAUTH_JWKS_URI, MCP_PUBLIC_URL, and " +
        "MCP_OAUTH_ALLOWED_SUBJECTS are all required for OAuth.",
      );
    }
    const issuer = parseSecureUrl(oauthIssuer, "MCP_OAUTH_ISSUER", env.NODE_ENV);
    const audience = parseSecureUrl(oauthAudience, "MCP_OAUTH_AUDIENCE", env.NODE_ENV);
    const canonicalPublicUrl = parseSecureUrl(publicUrl, "MCP_PUBLIC_URL", env.NODE_ENV);
    const jwksUri = parseSecureUrl(oauthJwksUri, "MCP_OAUTH_JWKS_URI", env.NODE_ENV);
    if (issuer.search) {
      throw new Error("MCP_OAUTH_ISSUER must not contain a query.");
    }
    if (canonicalPublicUrl.pathname !== "/" || canonicalPublicUrl.search || canonicalPublicUrl.hash) {
      throw new Error("MCP_PUBLIC_URL must be an origin without a path, query, or fragment.");
    }
    if (audience.href !== `${canonicalPublicUrl.origin}/mcp`) {
      throw new Error("MCP_OAUTH_AUDIENCE must exactly equal MCP_PUBLIC_URL plus /mcp.");
    }
    const requiredScopes = (oauthRequiredScopes ?? "premiere:mcp")
      .split(/[ ,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
    if (requiredScopes.length === 0 || requiredScopes.some((scope) => !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(scope))) {
      throw new Error("MCP_OAUTH_REQUIRED_SCOPES must contain one or more valid OAuth scope values.");
    }
    const allowedSubjects = oauthAllowedSubjects
      .split(",")
      .map((subject) => subject.trim())
      .filter(Boolean);
    if (
      allowedSubjects.length === 0 ||
      allowedSubjects.some((subject) => subject.length > 255 || /[\u0000-\u001F\u007F]/.test(subject))
    ) {
      throw new Error("MCP_OAUTH_ALLOWED_SUBJECTS must contain valid comma-separated token subjects.");
    }
    return {
      mode: "oauth",
      oauth: {
        issuer: issuer.pathname === "/" && !issuer.search ? issuer.origin : issuer.href,
        audience: audience.href,
        publicUrl: canonicalPublicUrl.origin,
        jwksUri: jwksUri.href,
        requiredScopes: [...new Set(requiredScopes)],
        allowedSubjects: [...new Set(allowedSubjects)],
      },
      allowUnauthenticated: false,
    };
  }

  if (authToken) return { mode: "shared-token", authToken, allowUnauthenticated: false };

  if (env.ALLOW_UNAUTHENTICATED === "1" && env.NODE_ENV !== "production") {
    return { mode: "unauthenticated", allowUnauthenticated: true };
  }

  throw new Error(
    "MCP_AUTH_TOKEN is required for the HTTP transport. " +
    "ALLOW_UNAUTHENTICATED=1 is permitted only outside NODE_ENV=production.",
  );
}

function parseSecureUrl(raw: string, name: string, nodeEnv: string | undefined): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  const localDevelopment = nodeEnv !== "production" &&
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
  if (parsed.protocol !== "https:" && !localDevelopment) {
    throw new Error(`${name} must use HTTPS (HTTP is allowed only for loopback development).`);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${name} must not contain credentials or a fragment.`);
  }
  return parsed;
}

export function getRequestPathname(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    return new URL(rawUrl, "http://localhost").pathname;
  } catch {
    return undefined;
  }
}

export function isSupportedMcpMethod(method: string | undefined): boolean {
  return MCP_HTTP_METHODS.some((allowed) => allowed === method);
}

export function requestContentLength(req: Pick<http.IncomingMessage, "headers">): number | undefined {
  const header = req.headers["content-length"];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

export function exceedsRequestBodyLimit(
  req: Pick<http.IncomingMessage, "headers">,
  maxRequestBytes: number,
): boolean {
  const contentLength = requestContentLength(req);
  return contentLength !== undefined && (!Number.isFinite(contentLength) || contentLength > maxRequestBytes);
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Reads an MCP request body with a hard byte cap before it reaches the transport.
 * This avoids attaching a second live data listener beside the transport, which
 * can otherwise race and consume a fast chunked body before the transport does.
 */
export function readBoundedRequestBody(req: http.IncomingMessage, maxRequestBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
    };
    const onData = (chunk: unknown) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      receivedBytes += buffer.length;
      if (receivedBytes <= maxRequestBytes) {
        chunks.push(buffer);
        return;
      }
      cleanup();
      // Drain rather than destroy so the caller can reliably send its 413.
      req.resume();
      reject(new RequestBodyTooLargeError());
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAborted = () => {
      cleanup();
      reject(new Error("Request aborted"));
    };

    req.on("data", onData);
    req.once("end", onEnd);
    req.once("error", onError);
    req.once("aborted", onAborted);
  });
}

export function isAuthorizedBearer(req: Pick<http.IncomingMessage, "headers">, authToken: string | undefined): boolean {
  if (!authToken) return true;
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header ?? "";
  if (!value.startsWith("Bearer ")) return false;
  const provided = Buffer.from(value.slice(7));
  const expected = Buffer.from(authToken);
  if (provided.length !== expected.length) return false;
  return timingSafeBufferEqual(provided, expected);
}

function timingSafeBufferEqual(left: Buffer, right: Buffer): boolean {
  return timingSafeEqual(left, right);
}

function hashedIdentity(value: string): string {
  // A process-local keyed digest prevents network addresses from being
  // recovered through an offline dictionary attack if a bucket key
  // is ever observed. The key and derived identities are never persisted.
  return createHmac("sha256", RATE_LIMIT_IDENTITY_KEY).update(value).digest("hex").slice(0, 32);
}

/**
 * The edge is authoritative by default. Honor X-Forwarded-For only after an
 * operator explicitly declares the proxy trusted; otherwise it is attacker
 * input and must not be used as a rate-limit identity.
 */
export function rateLimitIdentity(
  req: Pick<http.IncomingMessage, "headers" | "socket">,
  trustProxy: boolean,
): string {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const remoteAddress = trustProxy && forwardedValue
    ? forwardedValue.split(",")[0].trim()
    : req.socket?.remoteAddress ?? "unknown";
  return `ip:${hashedIdentity(remoteAddress || "unknown")}`;
}

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Bounded, process-local protection for a single machine. It deliberately does
 * not log or export identities. An edge/WAF remains necessary for fleet-wide
 * protection across restarts and multiple instances.
 */
export class HttpAdmissionController {
  private readonly buckets = new Map<string, TokenBucket>();
  private activeOperationRequests = 0;
  private activeStreamRequests = 0;

  constructor(
    private readonly settings: Pick<HttpAdmissionSettings, "maxConcurrentRequests" | "maxConcurrentStreams" | "rateLimitPerMinute" | "rateLimitBurst" | "maxRateLimitKeys">,
    private readonly clock: () => number = Date.now,
  ) {}

  acquire(identity: string, lane: AdmissionLane = "operation"): AdmissionDecision {
    const now = this.clock();
    this.pruneIdleBuckets(now);

    const bucket = this.getOrCreateBucket(identity, now);
    if (!bucket) {
      return { accepted: false, reason: "rate_limited", statusCode: 429, retryAfterSeconds: 60 };
    }

    const elapsed = Math.max(0, now - bucket.updatedAt);
    const refill = elapsed * (this.settings.rateLimitPerMinute / ONE_MINUTE_MS);
    bucket.tokens = Math.min(this.settings.rateLimitBurst, bucket.tokens + refill);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      const missing = 1 - bucket.tokens;
      const retryAfterSeconds = Math.max(1, Math.ceil((missing / this.settings.rateLimitPerMinute) * 60));
      return { accepted: false, reason: "rate_limited", statusCode: 429, retryAfterSeconds };
    }

    const activeRequests = lane === "stream" ? this.activeStreamRequests : this.activeOperationRequests;
    const maximumRequests = lane === "stream" ? this.settings.maxConcurrentStreams : this.settings.maxConcurrentRequests;
    if (activeRequests >= maximumRequests) {
      return { accepted: false, reason: "at_capacity", statusCode: 503, retryAfterSeconds: 1 };
    }

    bucket.tokens -= 1;
    if (lane === "stream") this.activeStreamRequests += 1;
    else this.activeOperationRequests += 1;
    let released = false;
    return {
      accepted: true,
      release: () => {
        if (released) return;
        released = true;
        if (lane === "stream") this.activeStreamRequests = Math.max(0, this.activeStreamRequests - 1);
        else this.activeOperationRequests = Math.max(0, this.activeOperationRequests - 1);
      },
    };
  }

  metrics(): AdmissionMetrics {
    return {
      activeRequests: this.activeOperationRequests + this.activeStreamRequests,
      activeOperationRequests: this.activeOperationRequests,
      activeStreamRequests: this.activeStreamRequests,
      trackedRateLimitKeys: this.buckets.size,
    };
  }

  private getOrCreateBucket(identity: string, now: number): TokenBucket | undefined {
    const existing = this.buckets.get(identity);
    if (existing) return existing;
    if (this.buckets.size >= this.settings.maxRateLimitKeys) return undefined;
    const bucket = { tokens: this.settings.rateLimitBurst, updatedAt: now };
    this.buckets.set(identity, bucket);
    return bucket;
  }

  private pruneIdleBuckets(now: number): void {
    const maxIdleMs = Math.max(ONE_MINUTE_MS, Math.ceil((this.settings.rateLimitBurst / this.settings.rateLimitPerMinute) * ONE_MINUTE_MS) * 2);
    for (const [identity, bucket] of this.buckets) {
      if (now - bucket.updatedAt > maxIdleMs) this.buckets.delete(identity);
    }
  }
}
