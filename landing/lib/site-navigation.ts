export const siteNavigation = [
  {
    label: "Product",
    links: [
      { label: "Recorded demo", href: "/demo/", description: "Watch an edit and inspect its verification receipt." },
      { label: "Compare MCP servers", href: "/compare/", description: "Choose by setup, workflow, and evidence." },
      { label: "The workflow", href: "/#features", description: "See how your assistant works with Premiere." },
      { label: "How it works", href: "/#how-it-works", description: "Understand the local connection." },
      { label: "Questions & answers", href: "/#faq", description: "Compatibility, privacy, and getting started." },
    ],
  },
  {
    label: "Get started",
    links: [
      { label: "Documentation", href: "/docs/", description: "Install, connect, and run your first safe check." },
      { label: "Setup & recovery", href: "/docs/troubleshooting/", description: "Find help when your connection needs attention." },
    ],
  },
  {
    label: "Workflows",
    links: [
      { label: "Workflow starter kit", href: "/workflows/", description: "Try a reviewable workflow with sample media." },
      { label: "Project intake", href: "/project-intake/", description: "Prepare a project for a clear handoff." },
      { label: "Workflow fit guide", href: "/premiere-pro-collaboration-workflow/", description: "Choose the right collaboration context." },
    ],
  },
  {
    label: "Resources",
    links: [
      { label: "Tool reference", href: "/tools/", description: "Search actions and check their availability." },
      { label: "Guides", href: "/blog/", description: "Explore assistant setup and editing guides." },
      { label: "Product facts", href: "/facts/", description: "Check versions, compatibility, and sources." },
      { label: "Changelog", href: "/changelog/", description: "Follow releases and improvements." },
    ],
  },
] as const
