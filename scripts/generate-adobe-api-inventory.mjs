import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = resolve(root, "node_modules/@adobe/premierepro/package.json");
const declarationsPath = process.env.PREMIERE_API_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_API_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro/src/premierepro.d.ts");
const coveragePath = resolve(root, "src/resources/adobe-uxp-coverage.json");
const outputPath = resolve(root, "src/resources/adobe-api-inventory.json");
const check = process.argv.includes("--check");
const validateOnly = process.argv.includes("--validate-only");

const [packageText, declarationsText, coverageText] = await Promise.all([
  readFile(packagePath, "utf8"),
  readFile(declarationsPath, "utf8"),
  readFile(coveragePath, "utf8"),
]);
const packageMetadata = JSON.parse(packageText);
const coverage = JSON.parse(coverageText);
const coveredApis = new Set(coverage.entries.flatMap((entry) => entry.adobeApi));
const source = ts.createSourceFile(declarationsPath, declarationsText, ts.ScriptTarget.Latest, true);
if (source.parseDiagnostics.length > 0) {
  const details = source.parseDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")).join("; ");
  throw new Error(`TypeScript declaration parse failed: ${details}`);
}
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const normalizedDeclarations = declarationsText.replaceAll("\r\n", "\n");
const declarationsSha256 = createHash("sha256").update(normalizedDeclarations).digest("hex");
const canonicalOwners = new Map();
const rootDeclaration = source.statements.find((statement) => (
  ts.isTypeAliasDeclaration(statement) && statement.name.text === "premierepro"
));
if (!rootDeclaration || !ts.isTypeLiteralNode(rootDeclaration.type)) {
  throw new Error("Adobe declarations must expose a premierepro root type literal.");
}
for (const member of rootDeclaration.type.members) {
  if (!ts.isPropertySignature(member) || !member.name || !member.type || !ts.isTypeReferenceNode(member.type)) continue;
  canonicalOwners.set(member.type.typeName.getText(source), member.name.getText(source).replaceAll('"', ""));
}

function memberName(member) {
  if (ts.isConstructSignatureDeclaration(member)) return "[[construct]]";
  if (ts.isCallSignatureDeclaration(member)) return "[[call]]";
  if (ts.isIndexSignatureDeclaration(member)) return "[[index]]";
  if (!member.name) throw new Error(`Unsupported anonymous type member: ${ts.SyntaxKind[member.kind]}`);
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
  throw new Error(`Unsupported type member: ${ts.SyntaxKind[member.kind]}`);
}

const symbols = [];
function addMember(owner, name, kind) {
  const canonicalOwner = canonicalOwners.get(owner) ?? owner;
  const symbol = `${canonicalOwner}.${name}`;
  const declarationSymbol = `${owner}.${name}`;
  symbols.push({ symbol, kind, ...(symbol === declarationSymbol ? {} : { declarationSymbol }) });
}

function collectTypeMembers(owner, node) {
  if (ts.isTypeLiteralNode(node)) {
    for (const member of node.members) {
      addMember(owner, memberName(member), memberKind(member));
    }
    return;
  }
  if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
    for (const type of node.types) collectTypeMembers(owner, type);
    return;
  }
  if (ts.isParenthesizedTypeNode(node)) collectTypeMembers(owner, node.type);
  else throw new Error(`Unsupported type expression for ${owner}: ${ts.SyntaxKind[node.kind]}`);
}

function collectModule(owner, moduleDeclaration) {
  symbols.push({ symbol: owner, kind: "namespace" });
  if (!moduleDeclaration.body) throw new Error(`Namespace ${owner} has no body.`);
  if (ts.isModuleDeclaration(moduleDeclaration.body)) {
    collectModule(`${owner}.${moduleDeclaration.body.name.getText(source).replaceAll('"', "")}`, moduleDeclaration.body);
    return;
  }
  if (!ts.isModuleBlock(moduleDeclaration.body)) {
    throw new Error(`Unsupported namespace body for ${owner}: ${ts.SyntaxKind[moduleDeclaration.body.kind]}`);
  }
  for (const child of moduleDeclaration.body.statements) {
    if (ts.isEnumDeclaration(child)) {
      const enumName = `${owner}.${child.name.text}`;
      symbols.push({ symbol: enumName, kind: "enum" });
      for (const member of child.members) {
        symbols.push({ symbol: `${enumName}.${member.name.getText(source).replaceAll('"', "")}`, kind: "enumMember" });
      }
    } else if (ts.isModuleDeclaration(child)) {
      collectModule(`${owner}.${child.name.getText(source).replaceAll('"', "")}`, child);
    } else {
      throw new Error(`Unsupported declaration in namespace ${owner}: ${ts.SyntaxKind[child.kind]}`);
    }
  }
}

for (const statement of source.statements) {
  if (ts.isTypeAliasDeclaration(statement)) {
    const owner = statement.name.text;
    symbols.push({ symbol: owner, kind: "type" });
    collectTypeMembers(owner, statement.type);
  } else if (ts.isModuleDeclaration(statement)) {
    collectModule(statement.name.getText(source).replaceAll('"', ""), statement);
  } else if (ts.isExportAssignment(statement) && statement.expression.getText(source) === "premierepro") {
    // The package's `export = premierepro` binds the root declaration object.
  } else {
    throw new Error(`Unsupported top-level Adobe declaration: ${ts.SyntaxKind[statement.kind]}`);
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
    declarationsSha256,
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

if (validateOnly) {
  console.log(`Validated ${entries.length} Adobe API symbols from ${packageMetadata.version}.`);
} else if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current.replaceAll("\r\n", "\n") !== rendered) {
    console.error("Adobe API inventory is stale. Run npm run adobe:api-inventory.");
    process.exitCode = 1;
  } else {
    console.log(`Adobe API inventory is current: ${entries.length} symbols from ${packageMetadata.version}.`);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote ${entries.length} Adobe API symbols (${mapped} mapped, ${entries.length - mapped} unmapped).`);
}
