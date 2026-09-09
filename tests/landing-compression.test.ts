import { describe, expect, it } from "vitest";
import { shouldGzipLanding } from "../src/landing-compression.js";

describe("landing response compression negotiation", () => {
  it.each(["text/html; charset=utf-8", "text/css", "application/javascript", "application/json", "image/svg+xml"])("compresses negotiated text: %s", (type) => {
    expect(shouldGzipLanding("br, gzip, deflate", type)).toBe(true);
  });
  it.each(["image/webp", "image/png", "video/mp4", "font/woff2"])("leaves precompressed binary formats alone: %s", (type) => {
    expect(shouldGzipLanding("gzip", type)).toBe(false);
  });
  it.each([undefined, "br", "gzip;q=0", "gzip;q=invalid", "gzip;q=1.2", "notgzip"])("respects unsupported or declined encoding: %s", (encoding) => {
    expect(shouldGzipLanding(encoding, "text/html")).toBe(false);
  });
  it("accepts weighted gzip even when another encoding is preferred", () => {
    expect(shouldGzipLanding("br;q=1, gzip;q=0.5", "text/html")).toBe(true);
  });
});
