import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = resolve(root, "node_modules/@adobe/cc-ext-uxp-types/package.json");
const declarationsPath = process.env.UXP_JS_DECLARATIONS_PATH
  ? resolve(process.env.UXP_JS_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/cc-ext-uxp-types/uxp/index.d.ts");
const coveragePath = resolve(root, "src/resources/uxp-js-coverage.json");
const outputPath = resolve(root, "src/resources/uxp-js-api-inventory.json");
const check = process.argv.includes("--check");
const validateOnly = process.argv.includes("--validate-only");

const [packageText, declarationsText, coverageText] = await Promise.all([
  readFile(packagePath, "utf8"),
  readFile(declarationsPath, "utf8"),
  readFile(coveragePath, "utf8"),
]);
const packageMetadata = JSON.parse(packageText);
const coverage = JSON.parse(coverageText);
const mappedSymbols = new Set(coverage.entries.flatMap((entry) => entry.uxpApi));
const source = ts.createSourceFile(declarationsPath, declarationsText, ts.ScriptTarget.Latest, true);
if (source.parseDiagnostics.length > 0) {
  const details = source.parseDiagnostics
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))
    .join("; ");
  throw new Error(`TypeScript declaration parse failed: ${details}`);
}

const normalizedDeclarations = declarationsText.replaceAll("\r\n", "\n");
const declarationsSha256 = createHash("sha256").update(normalizedDeclarations).digest("hex");
const symbols = [];
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const cleanName = (node) => node.getText(source).replaceAll('"', "").replaceAll("'", "");
const joinName = (owner, name) => owner ? `${owner}.${name}` : name;

function add(symbol, kind) {
  symbols.push({ symbol, kind });
}

function memberName(member) {
  if (ts.isConstructorDeclaration(member) || ts.isConstructSignatureDeclaration(member)) return "[[construct]]";
  if (ts.isCallSignatureDeclaration(member)) return "[[call]]";
  if (ts.isIndexSignatureDeclaration(member)) return "[[index]]";
  if (!member.name) throw new Error(`Unsupported anonymous UXP member: ${ts.SyntaxKind[member.kind]}`);
  return cleanName(member.name);
}

function memberKind(member) {
  if (ts.isConstructorDeclaration(member) || ts.isConstructSignatureDeclaration(member)) return "constructor";
  if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) return "method";
  if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) return "property";
  if (ts.isGetAccessorDeclaration(member)) return "getter";
  if (ts.isSetAccessorDeclaration(member)) return "setter";
  if (ts.isCallSignatureDeclaration(member)) return "call";
  if (ts.isIndexSignatureDeclaration(member)) return "index";
  throw new Error(`Unsupported UXP type member: ${ts.SyntaxKind[member.kind]}`);
}

function collectMembers(owner, members) {
  for (const member of members) add(joinName(owner, memberName(member)), memberKind(member));
}

function collectTypeNode(owner, node) {
  if (ts.isTypeLiteralNode(node)) {
    collectMembers(owner, node.members);
  } else if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
    for (const type of node.types) collectTypeNode(owner, type);
  } else if (ts.isParenthesizedTypeNode(node)) {
    collectTypeNode(owner, node.type);
  }
}

function collectStatements(statements, owner = "globalThis") {
  for (const statement of statements) {
    if (ts.isModuleDeclaration(statement)) {
      const moduleOwner = joinName(owner === "globalThis" ? "" : owner, cleanName(statement.name));
      add(moduleOwner, "module");
      collectModuleBody(statement.body, moduleOwner);
    } else if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      if (!statement.name) throw new Error(`Anonymous UXP declaration: ${ts.SyntaxKind[statement.kind]}`);
      const symbol = joinName(owner, statement.name.text);
      add(symbol, ts.isClassDeclaration(statement) ? "class" : "interface");
      collectMembers(symbol, statement.members);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      const symbol = joinName(owner, statement.name.text);
      add(symbol, "type");
      collectTypeNode(symbol, statement.type);
    } else if (ts.isEnumDeclaration(statement)) {
      const symbol = joinName(owner, statement.name.text);
      add(symbol, "enum");
      for (const member of statement.members) add(joinName(symbol, cleanName(member.name)), "enumMember");
    } else if (ts.isFunctionDeclaration(statement)) {
      if (!statement.name) throw new Error("Anonymous UXP function declaration");
      add(joinName(owner, statement.name.text), "function");
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) throw new Error("Unsupported destructured UXP variable declaration");
        add(joinName(owner, declaration.name.text), "variable");
      }
    } else if (ts.isExportAssignment(statement) || ts.isExportDeclaration(statement) || ts.isImportDeclaration(statement)) {
      // Module wiring does not add a callable or inspectable API symbol.
    } else {
      throw new Error(`Unsupported top-level UXP declaration: ${ts.SyntaxKind[statement.kind]}`);
    }
  }
}

function collectModuleBody(body, owner) {
  if (!body) throw new Error(`UXP module ${owner} has no body`);
  if (ts.isModuleDeclaration(body)) {
    const nestedOwner = joinName(owner, cleanName(body.name));
    add(nestedOwner, "module");
    collectModuleBody(body.body, nestedOwner);
  } else if (ts.isModuleBlock(body)) {
    collectStatements(body.statements, owner);
  } else {
    throw new Error(`Unsupported UXP module body: ${ts.SyntaxKind[body.kind]}`);
  }
}

collectStatements(source.statements);
const uniqueSymbols = [...new Map(symbols.map((entry) => [entry.symbol, entry])).values()]
  .sort((left, right) => compareText(left.symbol, right.symbol));
const declaredSymbols = new Set(uniqueSymbols.map((entry) => entry.symbol));
const entries = uniqueSymbols.map((entry) => ({
  ...entry,
  coverage: mappedSymbols.has(entry.symbol) ? "mapped" : "unmapped",
}));
const mapped = entries.filter((entry) => entry.coverage === "mapped").length;
const manifestOnly = [...mappedSymbols].filter((symbol) => !declaredSymbols.has(symbol)).sort(compareText);
const inventory = {
  schemaVersion: 1,
  source: {
    package: "@adobe/cc-ext-uxp-types",
    version: packageMetadata.version,
    declarations: "node_modules/@adobe/cc-ext-uxp-types/uxp/index.d.ts",
    declarationsSha256,
    coverageManifest: "src/resources/uxp-js-coverage.json",
  },
  semantics: {
    mapped: "The exact declaration symbol is referenced by panel coverage; this alone is not licensed-host verification.",
    unmapped: "No panel coverage entry references the exact declaration symbol; this is a review queue, not a requirement for a standalone MCP tool.",
  },
  stats: { total: entries.length, mapped, unmapped: entries.length - mapped, manifestOnly: manifestOnly.length },
  manifestOnly,
  entries,
};
const rendered = `${JSON.stringify(inventory, null, 2)}\n`;

if (validateOnly) {
  console.log(`Validated ${entries.length} UXP JavaScript API symbols from ${packageMetadata.version}.`);
} else if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current.replaceAll("\r\n", "\n") !== rendered) {
    console.error("UXP JavaScript API inventory is stale. Run npm run uxp:js-api-inventory.");
    process.exitCode = 1;
  } else {
    console.log(`UXP JavaScript API inventory is current: ${entries.length} symbols from ${packageMetadata.version}.`);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote ${entries.length} UXP JavaScript API symbols (${mapped} mapped, ${entries.length - mapped} unmapped).`);
}
