import { describe, expect, it, vi } from "vitest";
import { applyHttpSecurityHeaders, buildContentSecurityPolicy, HTTP_SECURITY_HEADERS } from "../src/http-security.js";

describe("HTTP security headers", () => {
  it("sets a restrictive baseline on every response", () => {
    const setHeader = vi.fn();
    applyHttpSecurityHeaders({ setHeader } as never);

    expect(setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
    expect(setHeader).toHaveBeenCalledWith(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    expect(setHeader).toHaveBeenCalledWith("Content-Security-Policy", buildContentSecurityPolicy());
  });

  it("denies every document capability because the transport serves no pages", () => {
    const policy = HTTP_SECURITY_HEADERS["Content-Security-Policy"];
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).not.toContain("script-src");
    expect(policy).not.toContain("connect-src");
    expect(policy).not.toContain("'unsafe-inline'");
  });
});
