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
import { ScrollStory } from "./scroll-story"
import "./studio.css"
import "./studio-editorial.css"
import "./studio-gallery.css"
import "./cinema-stage.css"
import "./cinema-timeline.css"
import "./cinema-workflow.css"
import "./studio-scroll.css"

export function StudioHome() {
  return (
    <StudioMotion>
      <SiteHeader homepage actions={<MotionToggle />} />
      <main id="main-content">
        <div className="studio-announcement">
          <span>A new connection for your creative workflow.</span>
          <a href="/changelog/">
            Explore v{product.version} <ArrowRight size={13} />
          </a>
        </div>
        <section id="top" className="studio-container studio-hero">
          <div className="studio-hero-copy" data-scroll-scene>
            <p className="studio-product-name">Premiere Pro MCP</p>
            <h1>
              Your vision.
              <br />
              In the <span>timeline.</span>
            </h1>
            <p className="studio-hero-description">
              Connect your AI assistant to Adobe Premiere Pro.
              <br className="studio-desktop-break" /> Plan, review, and shape your
              next edit.
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
                Explore the workflow <ArrowDown size={16} />
              </TrackedLink>
            </div>
            <p className="studio-hero-note">
              Free and open source. Your media stays local.
            </p>
          </div>
          <StudioStage />
          <div className="studio-compatible">
            <span>Works with the assistant you already use.</span>
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

        <ScrollStory />
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
                  <span>The creative toolkit.</span>
                </p>
                <h2>
                  Less repetition.
                  <br />
                  <span>More room to create.</span>
                </h2>
              </div>
              <p>
                From the first selects to the finishing touches. Give repetitive
                work a clear instruction, and keep the creative decisions yours.
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
            data-scroll-scene
            className="studio-container studio-demo"
            data-studio-reveal
          >
            <div className="studio-demo-heading studio-editorial-heading">
              <h2>
                From a request
                <br />
                <span>to a reviewable result.</span>
              </h2>
              <p>See how your direction becomes a plan you can inspect.</p>
            </div>
            <WalkthroughPlayer />
            <div className="studio-demo-caption">
              <span>AN ILLUSTRATED PRODUCT WALKTHROUGH</span>
              <p>
                A visual explanation of the request-to-result flow. This
                animation is not a recording of a live Premiere host session.
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
                <p className="studio-eyebrow">Designed around your control.</p>
                <h2>
                  Your assistant. Your edit.
                  <br />
                  <span>One thoughtful connection.</span>
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

        <div className="studio-light studio-setup-surface">
          <section
            id="install"
            data-scroll-scene
            className="studio-container studio-section"
            data-studio-reveal
          >
            <div className="studio-section-heading studio-editorial-heading">
              <div>
                <p className="studio-eyebrow">Make the connection.</p>
                <h2>
                  Ready when
                  <br />
                  <span>you are.</span>
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
              <p className="studio-eyebrow">A few things to know.</p>
              <h2>
                A little clarity.
                <br />
                <span>Before you begin.</span>
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
            <span className="studio-eyebrow">The next frame is yours.</span>
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
                  Connect to Premiere
                </TrackedLink>
                <p>
                  Free & open source.
                  <br />
                  Built for the way you create.
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
