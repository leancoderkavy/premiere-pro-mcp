export type ReferenceTool = {
  name: string
  description: string
  modes: string
  surface: string
}

export const toolSurfaces = {
  default: "Default profile",
  uxp: "Connected UXP",
  restricted: "Requires unsafe-script",
} as const

export function filterTools(tools: ReferenceTool[], query: string, surface: string) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return tools.filter((tool) => {
    if (surface !== "all" && tool.surface !== surface) return false
    const haystack = `${tool.name.replaceAll("_", " ")} ${tool.name} ${tool.description} ${tool.modes}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
