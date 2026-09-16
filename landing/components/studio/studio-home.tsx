import { SiteHeader } from "@/components/site/site-header"
import { Footer } from "@/components/sections/footer"
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
  WalkthroughPlayer,
  WorkflowChapters
} from "./studio-controls"
import { MotionToggle, StudioMotion } from "./studio-motion"
import { StudioStage } from "./cinema-stage"
import "./studio.css"
import "./studio-editorial.css"
import "./studio-gallery.css"
import "./cinema-stage.css"
import "./cinema-timeline.css"
import "./cinema-workflow.css"
import "./studio-scroll.css"
import "./cinema-nle.css"
import "./cinema-monitor.css"

export function StudioHome() {
  return (
    <StudioMotion>
      <SiteHeader homepage actions={<MotionToggle />} />
      <main id="main-content">
        <div className="studio-announcement">
          <span>Free, open-source tools for Premiere Pro.</span>
          <a href="/changelog/">
            Release notes · v{product.version} <ArrowRight size={13} />
          </a>
        </div>
        <section id="top" className="studio-container studio-hero">
          <div className="studio-hero-copy" data-scroll-scene>
            <p className="studio-product-name">Premiere Pro MCP</p>
            <h1>
              Your assistant.
              <br />
              Connected to <span>Premiere.</span>
            </h1>
            <p className="studio-hero-description">
              Inspect projects, organize media, and prepare edits.
              <br className="studio-desktop-break" /> Review the plan before changing your timeline.
            </p>
            <div className="studio-hero-actions">
              <TrackedLink
                href="#install"
                trackingLocation="hero"
                trackingDestination="safe_connection_check"
                className="studio-button studio-button-primary"
              >
                Connect to Premiere
              </TrackedLink>
              <TrackedLink
                href="#features"
                trackingLocation="hero"
                trackingDestination="workflow_starter_kit"
                className="studio-button studio-button-text"
              >
                See what it can do <ArrowDown size={16} />
              </TrackedLink>
            </div>
            <p className="studio-hero-note">
              Free and open source. Your media stays local.
            </p>
          </div>
          <StudioStage />
          <div className="studio-compatible">
            <span>Connect through a compatible MCP client.</span>
            <div>
              Claude <span>·</span> Codex <span>·</span> Cursor <span>·</span>
              Copilot <span>·</span> & more
            </div>
          </div>
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

        <div className="studio-light studio-workflow-surface">
          <section
            id="features"
            data-scroll-scene
            className="studio-container studio-section"
            data-studio-reveal
          >
            <div className="studio-section-heading studio-editorial-heading">
              <div>
                <p className="studio-eyebrow">
                  <span>Editing workflows</span>
                </p>
                <h2>
                  Organize. Assemble.
                  <br />
                  <span>Check the details.</span>
                </h2>
              </div>
              <p>
                Start with a specific task. Inspect the project, review the proposed
                changes, then check the result in Premiere.
              </p>
            </div>
            <WorkflowChapters />
            <div className="studio-section-foot">
              <span>
                <Check size={14} /> Preview. Confirm. Inspect the result.
              </span>
              <a href="/workflows/">
                Browse workflow examples <ArrowUpRight size={16} />
              </a>
            </div>
          </section>

          <section
            id="demo"
            data-scroll-scene
            className="studio-container studio-demo"
            data-studio-reveal
          >
            <div className="studio-demo-heading studio-editorial-heading">
              <h2>
                See the workflow
                <br />
                <span>before you install.</span>
              </h2>
              <p>Watch three clips become a sequence you can inspect in Premiere Pro.</p>
            </div>
            <WalkthroughPlayer />
            <div className="studio-demo-caption">
              <span>A CLOSER LOOK · 30 SECONDS · SOUND ON</span>
              <p>
                Real Premiere footage, cinematic sample artwork, an original
                score, and AI narration. See a request become an editable
                timeline you can review. <a href="/demo/">Watch the full workflow and inspect its receipt.</a>
              </p>
            </div>
          </section>
        </div>

        <section
          id="how-it-works"
          data-scroll-scene
          className="studio-bridge-section"
          data-studio-reveal
        >
          <div className="studio-container">
            <div className="studio-section-heading">
              <div>
                <p className="studio-eyebrow">How it connects</p>
                <h2>
                  Three parts.
                  <br />
                  <span>One local setup.</span>
                </h2>
              </div>
              <p>
                The MCP bridge runs alongside Premiere on your machine. Your
                assistant sends structured requests; you choose the context and
                confirm supported changes.
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
                <p>Describe the task.</p>
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
                <p>Routes supported requests.</p>
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
                <p>Review changes in your project.</p>
              </div>
            </div>
            <div className="studio-bridge-notes">
              <p>
                <ShieldCheck size={18} />
                <span>
                  <strong>Check the connection first.</strong> The starter prompt inspects
                  your project without changing it.
                </span>
              </p>
              <p>
                <Laptop size={18} />
                <span>
                  <strong>Check host compatibility.</strong> Available actions depend on
                  your Premiere version and connector. Inspect diagnostics after each operation.
                </span>
              </p>
            </div>
          </div>
        </section>

        <div className="studio-light studio-setup-surface">
          <section
            id="install"
            data-scroll-scene
            className="studio-container studio-section"
            data-studio-reveal
          >
            <div className="studio-section-heading studio-editorial-heading">
              <div>
                <p className="studio-eyebrow">Installation</p>
                <h2>
                  Choose your
                  <br />
                  <span>assistant.</span>
                </h2>
              </div>
              <p>
                Choose your assistant. Connect it to Premiere.
                Start with a safe, read-only check.
              </p>
            </div>
            <StudioInstaller />
          </section>

          <section
            id="faq"
            data-scroll-scene
            className="studio-container studio-faq-section"
            data-studio-reveal
          >
            <div>
              <p className="studio-eyebrow">Before you install</p>
              <h2>
                Questions
                <br />
                <span>and answers.</span>
              </h2>
              <a className="studio-text-link" href="/docs/">
                Read the documentation <ArrowUpRight size={16} />
              </a>
            </div>
            <StudioFaq />
          </section>
        </div>

        <section className="studio-final" data-studio-reveal data-scroll-scene>
          <div className="studio-container">
            <Image
              className="studio-final-mark"
              src="/marketing/premiere-pro-mcp-mark-v2.svg"
              width={64}
              height={64}
              alt=""
            />
            <span className="studio-eyebrow">Get started</span>
            <div>
              <h2>
                Connect your assistant
                <br />
                to <span>Premiere.</span>
              </h2>
              <div>
                <TrackedLink
                  href="#install"
                  trackingLocation="final_cta"
                  trackingDestination="safe_connection_check"
                  className="studio-button studio-button-primary"
                >
                  Connect to Premiere
                </TrackedLink>
                <p>
                  Free & open source.
                  <br />
                  No account required.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </StudioMotion>
  )
}
