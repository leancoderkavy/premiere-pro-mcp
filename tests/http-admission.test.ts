import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  HttpAdmissionController,
  RequestBodyTooLargeError,
  exceedsRequestBodyLimit,
  getRequestPathname,
  isAuthorizedBearer,
  isSupportedMcpMethod,
  rateLimitIdentity,
  readBoundedRequestBody,
  readHttpAdmissionSettings,
  readHttpAuthConfiguration,
  requestContentLength,
} from "../src/http-admission.js";

describe("HTTP admission settings", () => {
  it("uses bounded secure defaults and rejects invalid limits", () => {
    expect(readHttpAdmissionSettings({})).toMatchObject({
      maxRequestBytes: 1_048_576,
      maxConcurrentRequests: 8,
      rateLimitPerMinute: 120,
      rateLimitBurst: 30,
    });
    expect(() => readHttpAdmissionSettings({ MCP_MAX_REQUEST_BYTES: "unlimited" })).toThrow("MCP_MAX_REQUEST_BYTES");
    expect(() => readHttpAdmissionSettings({ MCP_RATE_LIMIT_PER_MINUTE: "10", MCP_RATE_LIMIT_BURST: "11" })).toThrow("MCP_RATE_LIMIT_BURST");
  });

  it("never permits unauthenticated HTTP in production", () => {
    expect(readHttpAuthConfiguration({ MCP_AUTH_TOKEN: "secret", NODE_ENV: "production" })).toEqual({
      mode: "shared-token", authToken: "secret", allowUnauthenticated: false,
    });
    expect(readHttpAuthConfiguration({ ALLOW_UNAUTHENTICATED: "1", NODE_ENV: "test" })).toEqual({
      mode: "unauthenticated", allowUnauthenticated: true,
    });
    expect(() => readHttpAuthConfiguration({ ALLOW_UNAUTHENTICATED: "1", NODE_ENV: "production" })).toThrow("MCP_AUTH_TOKEN");
  });

  it("requires complete HTTPS OAuth configuration and rejects ambiguous auth modes", () => {
    const oauth = readHttpAuthConfiguration({
      NODE_ENV: "production",
      MCP_OAUTH_ISSUER: "https://identity.example.com",
      MCP_OAUTH_AUDIENCE: "https://premiere.example.com/mcp",
      MCP_OAUTH_JWKS_URI: "https://identity.example.com/.well-known/jwks.json",
      MCP_PUBLIC_URL: "https://premiere.example.com",
      MCP_OAUTH_REQUIRED_SCOPES: "premiere:mcp premiere:read",
      MCP_OAUTH_ALLOWED_SUBJECTS: "user-1,user-2",
    });
    expect(oauth).toEqual({
      mode: "oauth",
      allowUnauthenticated: false,
      oauth: {
        issuer: "https://identity.example.com",
        audience: "https://premiere.example.com/mcp",
        jwksUri: "https://identity.example.com/.well-known/jwks.json",
        publicUrl: "https://premiere.example.com",
        requiredScopes: ["premiere:mcp", "premiere:read"],
        allowedSubjects: ["user-1", "user-2"],
      },
    });
    expect(() => readHttpAuthConfiguration({
      NODE_ENV: "production", MCP_OAUTH_ISSUER: "https://identity.example.com",
    })).toThrow("all required");
    expect(() => readHttpAuthConfiguration({
      NODE_ENV: "production",
      MCP_OAUTH_ISSUER: "http://identity.example.com",
      MCP_OAUTH_AUDIENCE: "https://premiere.example.com/mcp",
      MCP_OAUTH_JWKS_URI: "https://identity.example.com/jwks.json",
      MCP_PUBLIC_URL: "https://premiere.example.com",
      MCP_OAUTH_ALLOWED_SUBJECTS: "user-1",
    })).toThrow("HTTPS");
    expect(() => readHttpAuthConfiguration({
      NODE_ENV: "production",
      MCP_AUTH_TOKEN: "legacy",
      MCP_OAUTH_ISSUER: "https://identity.example.com",
    })).toThrow("either MCP_AUTH_TOKEN or MCP_OAUTH_ISSUER");
    expect(() => readHttpAuthConfiguration({
      NODE_ENV: "production",
      MCP_AUTH_TOKEN: "legacy",
      MCP_OAUTH_REQUIRED_SCOPES: "premiere:mcp",
    })).toThrow("either MCP_AUTH_TOKEN or MCP_OAUTH_ISSUER");
    expect(() => readHttpAuthConfiguration({
      NODE_ENV: "production",
      MCP_OAUTH_ISSUER: "https://identity.example.com",
      MCP_OAUTH_AUDIENCE: "https://other.example.com/mcp",
      MCP_OAUTH_JWKS_URI: "https://identity.example.com/jwks.json",
      MCP_PUBLIC_URL: "https://premiere.example.com",
      MCP_OAUTH_ALLOWED_SUBJECTS: "user-1",
    })).toThrow("exactly equal");
  });
});

describe("HTTP request classification", () => {
  it("accepts only the exact MCP pathname and supported methods", () => {
    expect(getRequestPathname("/mcp?client=desktop")).toBe("/mcp");
    expect(getRequestPathname("/mcp-typo")).not.toBe("/mcp");
    expect(getRequestPathname("/mcp%2Fprivate")).not.toBe("/mcp");
    expect(getRequestPathname(undefined)).toBeUndefined();
    expect(getRequestPathname("http://[")).toBeUndefined();
    expect(isSupportedMcpMethod("POST")).toBe(true);
    expect(isSupportedMcpMethod("PUT")).toBe(false);
    expect(isSupportedMcpMethod(undefined)).toBe(false);
  });

  it("rejects invalid or over-limit declared body sizes before parsing", () => {
    expect(exceedsRequestBodyLimit({ headers: { "content-length": "1024" } } as never, 1024)).toBe(false);
    expect(exceedsRequestBodyLimit({ headers: { "content-length": "1025" } } as never, 1024)).toBe(true);
    expect(exceedsRequestBodyLimit({ headers: { "content-length": "unknown" } } as never, 1024)).toBe(true);
    expect(requestContentLength({ headers: {} } as never)).toBeUndefined();
    expect(requestContentLength({ headers: { "content-length": ["1024", "2048"] } } as never)).toBe(1024);
    expect(Number.isNaN(requestContentLength({ headers: { "content-length": "9007199254740992" } } as never))).toBe(true);
  });

  it("bounds chunked bodies before transport parsing", async () => {
    const request = Object.assign(new EventEmitter(), {
      resume: vi.fn(),
    });
    const body = readBoundedRequestBody(request as never, 4);
    request.emit("data", Buffer.from("four"));
    request.emit("data", Buffer.from("!"));
    await expect(body).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(request.resume).toHaveBeenCalledOnce();

    const complete = Object.assign(new EventEmitter(), { resume: vi.fn() });
    const completeBody = readBoundedRequestBody(complete as never, 4);
    complete.emit("data", Buffer.from("ok"));
    complete.emit("data", "!");
    complete.emit("end");
    await expect(completeBody).resolves.toEqual(Buffer.from("ok!"));
  });

  it("compares bearer credentials without treating malformed headers as authorized", () => {
    const request = (authorization?: string) => ({ headers: { authorization } } as never);
    expect(isAuthorizedBearer(request("Bearer a-strong-token"), "a-strong-token")).toBe(true);
    expect(isAuthorizedBearer(request("Bearer wrong"), "a-strong-token")).toBe(false);
    expect(isAuthorizedBearer(request("Basic a-strong-token"), "a-strong-token")).toBe(false);
    expect(isAuthorizedBearer(request(), "a-strong-token")).toBe(false);
    expect(isAuthorizedBearer({ headers: { authorization: ["Bearer a-strong-token"] } } as never, "a-strong-token")).toBe(true);
    expect(isAuthorizedBearer(request(), undefined)).toBe(true);
  });

  it("does not trust forwarded addresses unless configured", () => {
    const request = {
      headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1" },
      socket: { remoteAddress: "10.0.0.1" },
    } as never;
    expect(rateLimitIdentity(request, false)).not.toBe(rateLimitIdentity(request, true));
    expect(rateLimitIdentity({ headers: { "x-forwarded-for": ["203.0.113.8"] }, socket: { remoteAddress: "10.0.0.1" } } as never, true)).toMatch(/^ip:/);
    expect(rateLimitIdentity({ headers: {}, socket: { remoteAddress: "" } } as never, false)).toMatch(/^ip:/);
    expect(rateLimitIdentity({ headers: {}, socket: {} } as never, true)).toMatch(/^ip:/);
  });
});

describe("HTTP admission controller", () => {
  it("bounds concurrent requests and makes release idempotent", () => {
    const controller = new HttpAdmissionController({
      maxConcurrentRequests: 1, rateLimitPerMinute: 100, rateLimitBurst: 10, maxRateLimitKeys: 16,
    });
    const first = controller.acquire("credential:a");
    expect(first.accepted).toBe(true);
    const second = controller.acquire("credential:b");
    expect(second).toMatchObject({ accepted: false, reason: "at_capacity", statusCode: 503 });
    if (first.accepted) {
      first.release();
      first.release();
    }
    expect(controller.metrics().activeRequests).toBe(0);
    expect(controller.acquire("credential:b").accepted).toBe(true);
  });

  it("enforces a bounded token bucket with Retry-After", () => {
    let now = 0;
    const controller = new HttpAdmissionController({
      maxConcurrentRequests: 5, rateLimitPerMinute: 60, rateLimitBurst: 2, maxRateLimitKeys: 16,
    }, () => now);
    const first = controller.acquire("credential:a");
    const second = controller.acquire("credential:a");
    if (first.accepted) first.release();
    if (second.accepted) second.release();
    expect(controller.acquire("credential:a")).toMatchObject({ accepted: false, statusCode: 429, retryAfterSeconds: 1 });
    now = 1_000;
    expect(controller.acquire("credential:a").accepted).toBe(true);
  });

  it("bounds tracked identities and prunes stale buckets", () => {
    let now = 0;
    const controller = new HttpAdmissionController({
      maxConcurrentRequests: 2, rateLimitPerMinute: 60, rateLimitBurst: 1, maxRateLimitKeys: 1,
    }, () => now);
    const first = controller.acquire("credential:a");
    if (first.accepted) first.release();
    expect(controller.acquire("credential:b")).toMatchObject({ accepted: false, reason: "rate_limited" });
    now = 120_001;
    const second = controller.acquire("credential:b");
    expect(second.accepted).toBe(true);
    expect(controller.metrics().trackedRateLimitKeys).toBe(1);
    if (second.accepted) second.release();
  });
});
