# Search health: September 10, 2026

The live crawl passed for 27 sitemap pages and 108 redirect checks. PageSpeed
Insights then found delivery and accessibility issues on the control homepage:
the 32px navigation mark downloaded a 426.6 KiB PNG, the demo poster downloaded
248.4 KiB, the assistant picker exposed buttons directly inside an ARIA list,
and several secondary labels had insufficient contrast. Its mobile lab result
was 83 performance, 91 accessibility, 100 best practices and 100 SEO, with a
4.7-second LCP, 40ms TBT and zero CLS. No real-user field data was available.

Source: [mobile PageSpeed report](https://pagespeed.web.dev/analysis/https-premiere-pro-mcp-com/6c4vzzvmhw?form_factor=mobile).
This is one emulated slow-4G lab sample, not a ranking or a field-performance result.

## Scoped correction

- Serve a 96px WebP derivative for small marks, preserving the original artwork.
- Give the demo image 640px/1280px WebP candidates and an accurate `sizes` rule;
  video posters also use the full-size WebP. The original PNGs remain available.
- Enforce byte budgets for these delivery assets in the existing build check.
- Give the assistant buttons a named group and retain their pressed state.
- Increase secondary text contrast and keep scroll-entry animation from fading
  readable text into its background.

Rebuild the delivery files after changing the originals with
`npm --prefix landing run images:optimize`, then run the landing lint, build,
export checker and browser verification. Generated derivatives are committed so
static deployment does not need an image transformation service.

The existing searchable tool reference, Cursor guide and comparison already
shipped in PR #489; this change does not add overlapping search-intent pages.
GSC measurements, indexing requests and the full dated domain/page inventory
remain in private run artifacts. Assess the new pages after a complete
post-publication observation window; do not attribute earlier growth to them.
