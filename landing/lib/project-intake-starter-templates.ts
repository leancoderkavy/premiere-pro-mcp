import templateData from "./project-intake-starter-templates.json"

export type ProjectIntakeStarterTemplate = {
  key: "editorial_handoff" | "proxy_ready" | "delivery_preflight"
  label: string
  description: string
  checks: string[]
  template: Record<string, unknown>
}

export const projectIntakeStarterTemplates = templateData.templates as ProjectIntakeStarterTemplate[]

export function formatProjectIntakeStarterRequest(starter: ProjectIntakeStarterTemplate) {
  return [
    "Run preview_project_intake with this exact template. Return the path-redacted report and proposed organization actions.",
    "Do not set include_paths. Do not change Premiere or persist the template.",
    "",
    JSON.stringify({ template: starter.template }, null, 2),
  ].join("\n")
}
