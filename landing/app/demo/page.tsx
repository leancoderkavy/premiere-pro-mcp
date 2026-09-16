import type { Metadata } from "next"
import { PublicPage } from "@/components/site/public-page"
import { HomeLink } from "@/components/ui/home-link"

const title = "Premiere Pro MCP demo: three clips to an editable timeline"
const description = "Watch a recorded Premiere Pro workflow: import three clips, assemble a 15-second sequence, add review markers, inspect the timeline, and save the project."
export const metadata: Metadata = {
  title, description, alternates: { canonical: "/demo/" },
  openGraph: { title, description, url: "/demo/", type: "video.other", images: ["/premiere-pro-mcp-demo-live-v2-poster-1280.webp"] },
}
const transcript = [
  ["00:00–00:04", "Request: assemble three coastal shots into a 15-second edit. Add a review marker at each cut. Save the project."],
  ["00:04–00:09", "Import three original sample clips into Premiere Pro. Each clip is five seconds long."],
  ["00:09–00:13", "Assemble the clips in order in a named sequence."],
  ["00:13–00:16", "Add review markers at the opening and each cut."],
  ["00:16–00:29", "Inspect each shot in Premiere’s Program Monitor and review the native timeline."],
  ["00:29–00:34", "Verified: three clips, 15 seconds, three review markers. Saved as an editable Premiere project."],
]
const video = {
  "@context": "https://schema.org", "@type": "VideoObject", name: title, description,
  thumbnailUrl: "https://premiere-pro-mcp.com/premiere-pro-mcp-demo-live-v2-poster-1280.webp",
  uploadDate: "2026-09-15T18:28:02Z", duration: "PT34S",
  contentUrl: "https://premiere-pro-mcp.com/premiere-pro-mcp-demo-live-v2.mp4",
  transcript: transcript.map(([time, text]) => `${time}: ${text}`).join("\n"),
}
export default function DemoPage() {
  return <PublicPage>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(video) }} />
    <main id="main-content" className="min-h-screen bg-site-bg px-5 py-16 text-site-text sm:py-24">
      <article className="mx-auto max-w-4xl space-y-10">
        <nav aria-label="Breadcrumb" className="text-sm text-site-muted"><HomeLink href="/">MCP for Adobe Premiere Pro</HomeLink> / Demo</nav>
        <header><p className="font-mono text-sm uppercase text-site-accent">Recorded in Premiere Pro · September 15, 2026</p><h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-6xl">Three clips. One editable timeline.</h1><p className="mt-6 text-lg text-site-muted">Watch the 34-second workflow, then inspect what was verified before trying it on a copy of your own project.</p></header>
        <video controls playsInline preload="none" poster="/premiere-pro-mcp-demo-live-v2-poster-1280.webp" className="aspect-video w-full rounded-xl border border-site-line" aria-label="Recorded Premiere Pro assembly and review workflow">
          <source src="/premiere-pro-mcp-demo-live-v2.mp4" type="video/mp4" />
          <track kind="captions" src="/premiere-pro-mcp-demo-live-v2.vtt" srcLang="en" label="English" default />
          <a href="/premiere-pro-mcp-demo-live-v2.mp4">Download the captioned workflow video</a>
        </video>
        <section className="space-y-4"><h2 className="text-2xl font-semibold">What the recording proves</h2><p>Premiere Pro 26.5.0 ran the CEP handlers for importing media, assembling a sequence, adding markers, and moving the playhead. A separate bridge readback returned three clips at 0–5, 5–10, and 10–15 seconds, markers at 0, 5, and 10 seconds, and a successful project save.</p><p>The native timeline and Program Monitor are recorded footage. The request and step labels are editorial overlays, not a captured AI conversation. Sample clips use generated coastal artwork; the final review frame is held longer in the edit. This demonstrates this particular assembly workflow, not every tool, host version, export, or color-grading operation.</p><a className="text-site-accent underline" href="/demo-evidence.json">Inspect the redacted verification receipt</a></section>
        <section className="space-y-4"><h2 className="text-2xl font-semibold">Try the same review workflow</h2><ol className="list-decimal space-y-3 pl-6"><li><a className="text-site-accent underline" href="/docs/">Install and verify the local connection</a> with Premiere open.</li><li>Use a new project or a saved copy. Choose three five-second sample clips and confirm their paths.</li><li>Ask for a named sequence in the intended order, with review markers at the opening and each cut.</li><li>Inspect the native timeline and returned clip positions. Save only to your intended project.</li></ol><p>Start with the <a href="/workflows/" className="text-site-accent underline">workflow starter kit</a> or check available actions in the <a href="/tools/" className="text-site-accent underline">tool reference</a>.</p></section>
        <section className="space-y-4"><h2 className="text-2xl font-semibold">Video transcript</h2><p className="text-site-muted">The walkthrough is silent. These captions describe the visible actions.</p><dl className="space-y-4">{transcript.map(([time, text]) => <div key={time}><dt className="font-mono text-sm text-site-accent">{time}</dt><dd className="mt-1">{text}</dd></div>)}</dl></section>
        <p>Evaluating alternatives? <a className="text-site-accent underline" href="/compare/">Compare Premiere Pro MCP servers by setup and workflow.</a></p>
      </article>
    </main>
  </PublicPage>
}
