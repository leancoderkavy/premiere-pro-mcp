import Image from "next/image"
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  Command,
  Github,
  Laptop,
  LockKeyhole,
  Monitor,
  Package,
  ShieldCheck
} from "lucide-react"
import { product } from "@/lib/product"
import { TrackedLink } from "@/components/ui/tracked-link"
import {
  StudioFaq,
  StudioInstaller,
  StudioMobileNav,
  WalkthroughPlayer,
  WorkflowChapters
} from "./studio-controls"
import { MotionToggle, StudioMotion, StudioStage } from "./studio-motion"
import "./studio.css"

const footerLinks = {
  Explore: [
    ["Workflow starter kit", "/workflows/"],
    ["Project intake", "/project-intake/"],
    ["Workflow fit guide", "/premiere-pro-collaboration-workflow/"],
    ["Setup & recovery", "/docs/troubleshooting/"]
  ],
  Resources: [
    ["Documentation", "/docs/"],
    ["Guides", "/blog/"],
    ["Changelog", "/changelog/"],
    ["Product facts", "/facts/"]
  ],
  "Open source": [
    ["GitHub", product.links.repository],
    ["npm package", product.links.npm],
    ["Report an issue", product.links.issues],
    ["Security", `${product.links.repository}/security/policy`]
  ]
}

export function StudioHome() {
  return (
    <StudioMotion>
      <header className="studio-header">
        <nav
          className="studio-container studio-navigation"
          aria-label="Primary navigation"
        >
          <a
            className="studio-brand"
            href="#top"
            aria-label="premiere/mcp home — Premiere Pro MCP"
          >
            <Image
              src="/marketing/premiere-pro-mcp-mark-v2.svg"
              width={30}
              height={30}
              alt=""
            />
            <span>
              premiere<span className="studio-brand-divider">/</span>mcp
            </span>
          </a>
          <div className="studio-desktop-nav">
            <a href="#features">The workflow</a>
            <a href="#how-it-works">How it works</a>
            <a href="/docs/">
              Docs <ArrowUpRight size={12} />
            </a>
          </div>
          <div className="studio-nav-actions">
            <MotionToggle />
            <a
              className="studio-github"
              href={product.links.repository}
              aria-label="View source on GitHub"
            >
              <Github size={19} />
            </a>
            <TrackedLink
              href="#install"
              trackingLocation="navigation"
              trackingDestination="safe_connection_check"
              className="studio-button studio-button-small"
            >
              Get connected <ArrowUpRight size={14} />
            </TrackedLink>
            <StudioMobileNav />
          </div>
        </nav>
      </header>
      <main id="main-content">
        <section id="top" className="studio-container studio-hero">
          <div className="studio-hero-copy">
            <a className="studio-release" href="/changelog/">
              <span className="studio-status-dot" /> OPEN SOURCE. OPEN
              POSSIBILITIES.
              <span>
                V{product.version}
                <ArrowUpRight size={11} />
              </span>
            </a>
            <h1>
              Your vision.
              <br />
              In the <span>timeline.</span>
            </h1>
            <p className="studio-hero-description">
              An AI connection for Adobe Premiere Pro.
              <br className="studio-desktop-break" /> Turn your direction into
              structured, reviewable edits—right where your story takes shape.
            </p>
            <div className="studio-hero-actions">
              <TrackedLink
                href="#install"
                trackingLocation="hero"
                trackingDestination="safe_connection_check"
                className="studio-button studio-button-primary"
              >
                Connect to Premiere <ArrowUpRight size={17} />
              </TrackedLink>
              <TrackedLink
                href="#features"
                trackingLocation="hero"
                trackingDestination="workflow_starter_kit"
                className="studio-button studio-button-text"
              >
                Explore the workflow <ArrowDown size={16} />
              </TrackedLink>
            </div>
            <p className="studio-hero-note">
              <ShieldCheck size={14} /> Local media. Reviewable plans. Your
              final say.
            </p>
            <div className="studio-compatible">
              <span>WORKS WITH YOUR MCP CLIENT</span>
              <div>
                <Command size={15} /> Claude <span>/</span> Cursor{" "}
                <span>/</span> Copilot <span>/</span> & more
              </div>
            </div>
          </div>
          <StudioStage />
        </section>
        <div
          className="studio-container studio-facts"
          aria-label="Product facts"
        >
          <div>
            <Package size={18} />
            <strong>{product.coreToolCount}</strong>
            <span>core tools</span>
          </div>
          <div>
            <Monitor size={18} />
            <strong>macOS + Windows</strong>
            <span>desktop hosts</span>
          </div>
          <div>
            <LockKeyhole size={18} />
            <strong>Local first</strong>
            <span>your media stays with you</span>
          </div>
          <div>
            <Github size={18} />
            <strong>Free. Open source.</strong>
            <span>MIT licensed</span>
          </div>
        </div>

        <section
          id="features"
          className="studio-container studio-section"
          data-studio-reveal
        >
          <div className="studio-section-heading">
            <div>
              <p className="studio-eyebrow">
                <span>01 / THE CREATIVE WORKFLOW</span>
              </p>
              <h2>
                Less repetition.
                <br />
                <span>More room to create.</span>
              </h2>
            </div>
            <p>
              Keep the creative decisions.
              <br />
              Give the repetitive work a structured path.
              <br />
              From the first selects to the final details.
            </p>
          </div>
          <WorkflowChapters />
          <div className="studio-section-foot">
            <span>
              <Check size={14} /> Preview. Confirm. Inspect the result.
            </span>
            <a href="/workflows/">
              Find your next workflow <ArrowUpRight size={16} />
            </a>
          </div>
        </section>

        <section
          id="demo"
          className="studio-container studio-demo"
          data-studio-reveal
        >
          <WalkthroughPlayer />
          <div className="studio-demo-caption">
            <span>AN ILLUSTRATED PRODUCT WALKTHROUGH</span>
            <p>
              A visual explanation of the request-to-result flow. This animation
              is not a recording of a live Premiere host session.
            </p>
          </div>
        </section>

        <section
          id="how-it-works"
          className="studio-bridge-section"
          data-studio-reveal
        >
          <div className="studio-container">
            <div className="studio-section-heading">
              <div>
                <p className="studio-eyebrow">02 / CONNECTED. ON YOUR TERMS.</p>
                <h2>
                  A powerful connection.
                  <br />
                  <span>A local foundation.</span>
                </h2>
              </div>
              <p>
                Your assistant, the MCP bridge, and Premiere work together on
                your machine. You choose the context and confirm supported
                changes.
              </p>
            </div>
            <div
              className="studio-bridge"
              aria-label="An assistant sends a structured request through the local MCP bridge to Adobe Premiere Pro"
            >
              <div className="studio-bridge-node">
                <span className="studio-node-icon">
                  <Command size={34} strokeWidth={1.3} />
                </span>
                <h3>Your assistant</h3>
                <p>You set the direction.</p>
              </div>
              <div className="studio-bridge-wire" aria-hidden="true">
                <span>STRUCTURED REQUEST</span>
                <i />
                <ArrowRight size={16} />
              </div>
              <div className="studio-bridge-node studio-bridge-core">
                <span className="studio-node-icon">
                  <Image
                    src="/marketing/premiere-pro-mcp-mark-v2.svg"
                    width={48}
                    height={48}
                    alt=""
                  />
                </span>
                <h3>The MCP bridge</h3>
                <p>A reviewable plan.</p>
                <span className="studio-bridge-local">
                  <LockKeyhole size={11} /> ON YOUR COMPUTER
                </span>
              </div>
              <div className="studio-bridge-wire" aria-hidden="true">
                <span>SUPPORTED ACTION</span>
                <i />
                <ArrowRight size={16} />
              </div>
              <div className="studio-bridge-node">
                <span className="studio-node-icon studio-premiere-icon">
                  Pr
                </span>
                <h3>Adobe Premiere Pro</h3>
                <p>The edit stays here.</p>
              </div>
            </div>
            <div className="studio-bridge-notes">
              <p>
                <ShieldCheck size={18} />
                <span>
                  <strong>Start with verification.</strong> The first prompt is
                  read-only. Applied plans require current targets and your
                  confirmation.
                </span>
              </p>
              <p>
                <Laptop size={18} />
                <span>
                  <strong>Know what’s supported.</strong> Capabilities vary by
                  host and bridge. Returned diagnostics help you inspect the
                  outcome.
                </span>
              </p>
            </div>
          </div>
        </section>

        <section
          id="install"
          className="studio-container studio-section"
          data-studio-reveal
        >
          <div className="studio-section-heading">
            <div>
              <p className="studio-eyebrow">03 / MAKE THE CONNECTION</p>
              <h2>
                Your next great edit
                <br />
                <span>starts right here.</span>
              </h2>
            </div>
            <p>
              Choose your assistant.
              <br />
              Connect it to Premiere.
              <br />
              Start with a check that changes nothing.
            </p>
          </div>
          <StudioInstaller />
        </section>

        <section
          id="faq"
          className="studio-container studio-faq-section"
          data-studio-reveal
        >
          <div>
            <p className="studio-eyebrow">A FEW THINGS TO KNOW</p>
            <h2>
              Clear answers.
              <br />
              <span>Then, create.</span>
            </h2>
            <a className="studio-text-link" href="/docs/">
              Read the documentation <ArrowUpRight size={16} />
            </a>
          </div>
          <StudioFaq />
        </section>

        <section className="studio-final" data-studio-reveal>
          <div className="studio-container">
            <span className="studio-eyebrow">
              <span className="studio-status-dot" /> THE NEXT FRAME IS YOURS.
            </span>
            <div>
              <h2>
                Make room
                <br />
                for <span>your vision.</span>
              </h2>
              <div>
                <TrackedLink
                  href="#install"
                  trackingLocation="final_cta"
                  trackingDestination="safe_connection_check"
                  className="studio-button studio-button-primary"
                >
                  Connect to Premiere <ArrowUpRight size={18} />
                </TrackedLink>
                <p>
                  Free & open source.
                  <br />
                  Built for the way you create.
                </p>
              </div>
            </div>
            <div className="studio-final-rule" aria-hidden="true">
              {Array.from({ length: 36 }, (_, i) => (
                <i key={i} />
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="studio-container studio-footer">
        <div className="studio-footer-top">
          <div>
            <a className="studio-brand" href="#top">
              <Image
                src="/marketing/premiere-pro-mcp-mark-v2.svg"
                width={30}
                height={30}
                alt=""
              />
              <span>
                premiere<span className="studio-brand-divider">/</span>mcp
              </span>
            </a>
            <p>
              Structured AI control.
              <br />
              Creative freedom.
            </p>
          </div>
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h2>{title}</h2>
              {links.map(([label, href]) => (
                <a key={label} href={href}>
                  {label}
                </a>
              ))}
            </div>
          ))}
        </div>
        <div className="studio-footer-bottom">
          <span>© 2026 Premiere Pro MCP contributors. MIT licensed.</span>
          <a href="/privacy/">Privacy</a>
          <a href="#top">Back to top ↑</a>
        </div>
        <p className="studio-trademark">
          Independent open-source project. Not affiliated with Adobe Inc. Adobe
          Premiere Pro is a trademark of Adobe Inc.
        </p>
      </footer>
    </StudioMotion>
  )
}
