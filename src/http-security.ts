import type http from "node:http";

/**
 * The HTTP transport serves JSON, redirects, and MCP streams only. It never
 * returns an HTML document, so the policy denies every fetch, frame, and form.
 */
export function buildContentSecurityPolicy(): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
}

export const HTTP_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": buildContentSecurityPolicy(),
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
});

export function applyHttpSecurityHeaders(res: http.ServerResponse): void {
  for (const [name, value] of Object.entries(HTTP_SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
}
