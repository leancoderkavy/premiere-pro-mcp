# Workflow launch validation

Local validation on September 4, 2026. These checks establish repository, browser,
and synthetic-media behavior. They are not production deployment or Premiere-host evidence.

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 145 test files, 2,566 tests, source inventories, generated references, package build, branding and registry-metadata checks |
| `npm run pack:check` | Passed: package contents and isolated CLI install |
| Landing production build | Passed: 26 static outputs, including workflow and recovery pages |
| Landing lint | Passed |
| Static marketing preflight | 14/14 checks passed; corpus-level advisory only |
| Existing landing performance budget | 210,771 initial JavaScript gzip bytes against 240,000 budget |
| Mobile layouts | No horizontal overflow at 360/390/430 CSS pixels on workflows, recovery, facts, Claude setup, and automation guides |
| Desktop workflow page | No overflow at 1280 CSS pixels |
| Browser download | Correct filename; downloaded ZIP SHA-256 matches checked-in ZIP |
| Copy actions | Prompt and public recipe link verified; denied clipboard access exposes manual recovery and sends no success event |
| Privacy | Fresh GPC-enabled browser made zero analytics vendor requests and queued zero events; UI copy still worked. Unit tests also cover DNT and privacy changes before idle loading |
| Accessibility behavior | Skip link, keyboard access, reduced-motion setting, live status, and 44px recipe buttons checked |
| Discovery | New routes have distinct canonical/title metadata; rendered JSON-LD parses; workflow links returned 200 through the actual repository HTTP server |
| MCP boundary | Anonymous POST to local `/mcp` returned 401 |
| Lighthouse, mobile lab | Performance 80, Accessibility 100, Best Practices 100, SEO 100; simulated LCP 5.2s, FCP 1.4s, CLS 0. Field Core Web Vitals remain unmeasured |
| Docker | Build-context regression test passed; Docker executable unavailable, so no container build claimed |

The initial Lighthouse run wrote a report but hit Windows temporary-profile cleanup
permissions. A second run using a separately launched headless Chrome debugging port
completed successfully. Scores are local lab observations, not ranking or field-performance claims.

Browser artifacts were retained under the isolated worktree's `output/playwright/`.
Synthetic MP4 metadata and content hashes are in `fixture-manifest.json` inside the
downloadable ZIP. Host checks remain `not_run`; no native `.prproj`, licensed-host
recording, independent install, testimonial, or external publication is claimed.
