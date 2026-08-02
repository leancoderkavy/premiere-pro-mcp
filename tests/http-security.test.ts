import { describe, expect, it, vi } from "vitest";
import { applyHttpSecurityHeaders, HTTP_SECURITY_HEADERS } from "../src/http-security.js";

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
  });

  it("blocks framing, plugins, and unlisted network destinations", () => {
    const policy = HTTP_SECURITY_HEADERS["Content-Security-Policy"];
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain("connect-src *");
  });
});
