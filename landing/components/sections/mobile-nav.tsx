"use client"

import { Menu, X } from "lucide-react"
import { useEffect, useState } from "react"

const mobileLinks = [
  { label: "Demo", href: "#demo" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Workflows", href: "/workflows/" },
  { label: "Install", href: "#install" },
  { label: "FAQ", href: "#faq" },
  { label: "Guides", href: "/blog/" },
  { label: "Docs", href: "/docs/" },
  { label: "Changelog", href: "/changelog/" },
] as const

export function MobileNav() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }

    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [open])

  return (
    <div className="relative lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="mobile-navigation"
        aria-label={open ? "Close navigation" : "Open navigation"}
        className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700 text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
      >
        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>
      <div
        id="mobile-navigation"
        aria-hidden={!open}
        className={`absolute right-0 top-12 w-56 origin-top-right overflow-hidden rounded-lg border border-zinc-800 bg-[#0b0b0e] p-2 shadow-2xl transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
          open ? "visible scale-100 opacity-100" : "invisible scale-[0.98] opacity-0 pointer-events-none"
        }`}
      >
        {mobileLinks.map((item) => (
          <a
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            tabIndex={open ? 0 : -1}
            className="block min-h-11 rounded-md px-3 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
          >
            {item.label}
          </a>
        ))}
      </div>
    </div>
  )
}
