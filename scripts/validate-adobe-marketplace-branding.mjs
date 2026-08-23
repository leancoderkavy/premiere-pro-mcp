#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const displayName = "MCP for Adobe Premiere Pro";
const retiredDisplayNames = ["Premiere Pro MCP", "Premiere Pro MCP Bridge", "MCP Bridge"];

const surfaces = [
  {
    file: "cep-plugin/CSXS/manifest.xml",
    required: [
      `ExtensionBundleName=\"${displayName}\"`,
      `<Menu>${displayName}</Menu>`,
    ],
  },
  {
    file: "cep-plugin/index.html",
    required: [`<title>${displayName}</title>`, `<h1>${displayName}</h1>`],
  },
  {
    file: "uxp-plugin/manifest.json",
    required: [
      `\"name\": \"${displayName}\"`,
      `\"label\": { \"default\": \"${displayName}\" }`,
    ],
  },
  {
    file: "uxp-plugin/index.html",
    required: [`<h3>${displayName}</h3>`],
  },
  {
    file: "claude-desktop/manifest.json",
    required: [`\"display_name\": \"${displayName}\"`],
  },
  {
    file: "landing/lib/product.ts",
    required: [`name: \"${displayName}\"`],
  },
  {
    file: "landing/app/manifest.ts",
    required: [`name: \"${displayName}\"`],
  },
  {
    file: "README.md",
    required: [`# ${displayName}`],
  },
];

const errors = [];

for (const surface of surfaces) {
  const source = await readFile(path.join(root, surface.file), "utf8");
  for (const required of surface.required) {
    if (!source.includes(required)) {
      errors.push(`${surface.file} is missing required display name evidence: ${required}`);
    }
  }
  for (const retired of retiredDisplayNames) {
    if (source.includes(retired)) {
      errors.push(`${surface.file} still exposes retired display name: ${retired}`);
    }
  }
}

if (errors.length > 0) {
  throw new Error(`Adobe Marketplace branding validation failed:\n- ${errors.join("\n- ")}`);
}

console.log(`Validated Marketplace display-name consistency across ${surfaces.length} source surfaces.`);
