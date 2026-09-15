"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Dialog } from "radix-ui"
import { ArrowUpRight, ChevronDown, Menu, X } from "lucide-react"
import { siteNavigation } from "@/lib/site-navigation"

export function SiteNavigation({ homepage = false }: { homepage?: boolean }) {
  const pathname = usePathname()
  const desktop = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const hrefFor = (href: string) => homepage && href.startsWith("/#") ? href.slice(1) : href
  const isCurrent = (href: string) => !href.includes("#") && pathname?.replace(/\/$/, "") === href.replace(/\/$/, "")

  useEffect(() => {
    function dismiss(event: KeyboardEvent | PointerEvent) {
      const active = desktop.current?.querySelector<HTMLDetailsElement>("details[open]")
      if (!active) return
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        active.open = false
        active.querySelector("summary")?.focus()
      } else if (event instanceof PointerEvent && !active.contains(event.target as Node)) {
        active.open = false
      }
    }
    document.addEventListener("keydown", dismiss)
    document.addEventListener("pointerdown", dismiss)
    return () => {
      document.removeEventListener("keydown", dismiss)
      document.removeEventListener("pointerdown", dismiss)
    }
  }, [])

  return (
    <>
      <div className="site-desktop-nav" ref={desktop}>
        {siteNavigation.map(group => (
          <details className="site-nav-group" key={group.label} onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
          }} onToggle={event => {
            if (!event.currentTarget.open) return
            desktop.current?.querySelectorAll("details").forEach(details => {
              if (details !== event.currentTarget) details.open = false
            })
          }}>
            <summary className={group.links.some(link => isCurrent(link.href)) ? "site-nav-current" : undefined}>
              {group.label}<ChevronDown size={13} aria-hidden="true" />
            </summary>
            <div className="site-nav-panel">
              {group.links.map(link => (
                <a key={link.href} href={hrefFor(link.href)} aria-current={isCurrent(link.href) ? "page" : undefined} onClick={event => {
                  const details = event.currentTarget.closest("details")
                  if (details) details.open = false
                }}>
                  <span>{link.label}<ArrowUpRight size={14} aria-hidden="true" /></span>
                  <small>{link.description}</small>
                </a>
              ))}
            </div>
          </details>
        ))}
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button className="site-menu-button" aria-label="Open navigation"><Menu size={21} /></button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="site-dialog-overlay" />
          <Dialog.Content className="site-nav-dialog">
            <Dialog.Title>Explore Premiere Pro MCP</Dialog.Title>
            <Dialog.Description className="sr-only">Product pages, setup help, and editing resources.</Dialog.Description>
            <Dialog.Close className="site-dialog-close" aria-label="Close navigation"><X size={22} /></Dialog.Close>
            <nav aria-label="Mobile navigation">
              <a className="site-mobile-connect" href={homepage ? "#install" : "/#install"} onClick={() => setOpen(false)}>Connect to Premiere<ArrowUpRight size={16} /></a>
              {siteNavigation.map(group => (
                <div className="site-mobile-group" key={group.label}>
                  <h2>{group.label}</h2>
                  {group.links.map(link => (
                    <a key={link.href} href={hrefFor(link.href)} aria-current={isCurrent(link.href) ? "page" : undefined} onClick={() => setOpen(false)}>{link.label}<ArrowUpRight size={15} aria-hidden="true" /></a>
                  ))}
                </div>
              ))}
              <a href="/privacy/" onClick={() => setOpen(false)}>Privacy</a>
            </nav>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
