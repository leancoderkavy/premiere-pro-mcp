"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Menu, X } from "lucide-react"
import { useState } from "react"

const mobileLinks = [
  { label: "Demo", href: "#demo" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Install", href: "#install" },
  { label: "FAQ", href: "#faq" },
  { label: "Docs", href: "/docs/" },
  { label: "Changelog", href: "/changelog/" },
] as const

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const reduceMotion = useReducedMotion()

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
      <AnimatePresence>
        {open ? (
          <motion.div
            id="mobile-navigation"
            initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-12 w-56 overflow-hidden rounded-lg border border-zinc-800 bg-[#0b0b0e] p-2 shadow-2xl"
          >
            {mobileLinks.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
