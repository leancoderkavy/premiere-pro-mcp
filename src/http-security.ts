import type http from "node:http";

export interface HttpSecurityHeaderOptions {
  scriptNonce?: string;
}

export function buildContentSecurityPolicy(options: HttpSecurityHeaderOptions = {}): string {
  const scriptSource = [
    "'self'",
    ...(options.scriptNonce ? [`'nonce-${options.scriptNonce}'`] : []),
    "https://www.googletagmanager.com",
  ].join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "media-src 'self'",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSource}`,
    "connect-src 'self' https://www.google.com https://www.google-analytics.com https://www.googletagmanager.com https://us.i.posthog.com https://*.posthog.com",
    "upgrade-insecure-requests",
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

export function applyHttpSecurityHeaders(res: http.ServerResponse, options: HttpSecurityHeaderOptions = {}): void {
  const headers = {
    ...HTTP_SECURITY_HEADERS,
    "Content-Security-Policy": buildContentSecurityPolicy(options),
  };
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
}
