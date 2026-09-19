import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("changelog page layout", () => {
  it("does not stack a large intro pad on top of the shared public-content main padding", () => {
    const page = read("landing/app/changelog/page.tsx");
    const site = read("landing/components/site/site.css");

    expect(site).toContain(".public-content main { padding-top: 40px;");
    expect(page).toContain('className="border-b border-site-line px-5 pb-12 md:pb-16"');
    expect(page).not.toContain("px-5 py-16 md:py-24");
  });
});
