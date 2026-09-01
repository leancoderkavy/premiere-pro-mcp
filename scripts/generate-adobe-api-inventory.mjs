import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = resolve(root, "node_modules/@adobe/premierepro/package.json");
const declarationsPath = resolve(root, "node_modules/@adobe/premierepro/src/premierepro.d.ts");
const coveragePath = resolve(root, "src/resources/adobe-uxp-coverage.json");
const outputPath = resolve(root, "src/resources/adobe-api-inventory.json");
const check = process.argv.includes("--check");

const [packageText, declarationsText, coverageText] = await Promise.all([
  readFile(packagePath, "utf8"),
  readFile(declarationsPath, "utf8"),
  readFile(coveragePath, "utf8"),
]);
const packageMetadata = JSON.parse(packageText);
const coverage = JSON.parse(coverageText);
const coveredApis = new Set(coverage.entries.flatMap((entry) => entry.adobeApi));
const source = ts.createSourceFile(declarationsPath, declarationsText, ts.ScriptTarget.Latest, true);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function memberName(member) {
  if (ts.isConstructSignatureDeclaration(member)) return "[[construct]]";
  if (ts.isCallSignatureDeclaration(member)) return "[[call]]";
  if (!member.name) return undefined;
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name)) {
    return member.name.text;
  }
  return member.name.getText(source);
}

function memberKind(member) {
  if (ts.isMethodSignature(member)) return "method";
  if (ts.isPropertySignature(member)) return "property";
  if (ts.isConstructSignatureDeclaration(member)) return "constructor";
  if (ts.isCallSignatureDeclaration(member)) return "call";
  if (ts.isIndexSignatureDeclaration(member)) return "index";
  return "member";
}

const symbols = [];
for (const statement of source.statements) {
  if (ts.isTypeAliasDeclaration(statement)) {
    const owner = statement.name.text;
    symbols.push({ symbol: owner, kind: "type" });
    if (ts.isTypeLiteralNode(statement.type)) {
      for (const member of statement.type.members) {
        const name = memberName(member);
        if (name) symbols.push({ symbol: `${owner}.${name}`, kind: memberKind(member) });
      }
    }
  } else if (ts.isModuleDeclaration(statement)) {
    const owner = statement.name.getText(source).replaceAll('"', "");
    symbols.push({ symbol: owner, kind: "namespace" });
    if (statement.body && ts.isModuleBlock(statement.body)) {
      for (const child of statement.body.statements) {
        if (ts.isEnumDeclaration(child)) {
          const enumName = `${owner}.${child.name.text}`;
          symbols.push({ symbol: enumName, kind: "enum" });
          for (const member of child.members) {
            symbols.push({ symbol: `${enumName}.${member.name.getText(source).replaceAll('"', "")}`, kind: "enumMember" });
          }
        }
      }
    }
  }
}

const uniqueSymbols = [...new Map(symbols.map((entry) => [entry.symbol, entry])).values()]
  .sort((left, right) => compareText(left.symbol, right.symbol));
const entries = uniqueSymbols.map((entry) => ({
  ...entry,
  coverage: coveredApis.has(entry.symbol) ? "mapped" : "unmapped",
}));
const mapped = entries.filter((entry) => entry.coverage === "mapped").length;
const declaredSymbols = new Set(entries.map((entry) => entry.symbol));
const manifestOnly = [...coveredApis].filter((symbol) => !declaredSymbols.has(symbol)).sort(compareText);
const inventory = {
  schemaVersion: 1,
  source: {
    package: "@adobe/premierepro",
    version: packageMetadata.version,
    declarations: "node_modules/@adobe/premierepro/src/premierepro.d.ts",
    coverageManifest: "src/resources/adobe-uxp-coverage.json",
  },
  semantics: {
    mapped: "The exact declaration symbol is referenced by at least one coverage-manifest entry; this alone is not live-host verification.",
    unmapped: "No coverage-manifest entry references the exact declaration symbol; this is a review queue, not proof that a standalone MCP tool is appropriate.",
  },
  stats: {
    total: entries.length,
    mapped,
    unmapped: entries.length - mapped,
    manifestOnly: manifestOnly.length,
  },
  manifestOnly,
  entries,
};
const rendered = `${JSON.stringify(inventory, null, 2)}\n`;

if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current !== rendered) {
    console.error("Adobe API inventory is stale. Run npm run adobe:api-inventory.");
    process.exitCode = 1;
  } else {
    console.log(`Adobe API inventory is current: ${entries.length} symbols from ${packageMetadata.version}.`);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote ${entries.length} Adobe API symbols (${mapped} mapped, ${entries.length - mapped} unmapped).`);
}
