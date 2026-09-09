/** Compress text only; video, WebP and font formats already have compression. */
export function shouldGzipLanding(acceptEncoding: string | undefined, contentType: string): boolean {
  if (!/^(text\/|application\/(javascript|json)|image\/svg\+xml)/.test(contentType)) return false;
  return (acceptEncoding ?? "").split(",").some((entry) => {
    const [name, ...parameters] = entry.trim().toLowerCase().split(";");
    if (name.trim() !== "gzip") return false;
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    if (!quality) return true;
    const weight = Number(quality.trim().slice(2));
    return Number.isFinite(weight) && weight > 0 && weight <= 1;
  });
}
