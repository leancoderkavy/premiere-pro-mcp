import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stablePackagePath = resolve(root, "node_modules/@adobe/premierepro/package.json");
const betaPackagePath = resolve(root, "node_modules/@adobe/premierepro-beta/package.json");
const stableDeclarationsPath = process.env.PREMIERE_BETA_AAF_EXPORT_OPTIONS_STABLE_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_AAF_EXPORT_OPTIONS_STABLE_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro/src/premierepro.d.ts");
const betaDeclarationsPath = process.env.PREMIERE_BETA_AAF_EXPORT_OPTIONS_BETA_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_AAF_EXPORT_OPTIONS_BETA_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro-beta/src/premierepro.d.ts");
const outputPath = process.env.PREMIERE_BETA_AAF_EXPORT_OPTIONS_DRIFT_OUTPUT_PATH
  ? resolve(process.env.PREMIERE_BETA_AAF_EXPORT_OPTIONS_DRIFT_OUTPUT_PATH)
  : resolve(root, "src/resources/adobe-beta-aaf-export-options-drift.json");
const check = process.argv.includes("--check");
const validateOnly = process.argv.includes("--validate-only");

const [stablePackageText, betaPackageText, stableDeclarations, betaDeclarations] = await Promise.all([
  readFile(stablePackagePath, "utf8"),
  readFile(betaPackagePath, "utf8"),
  readFile(stableDeclarationsPath, "utf8"),
  readFile(betaDeclarationsPath, "utf8"),
]);

const stablePackage = JSON.parse(stablePackageText);
const betaPackage = JSON.parse(betaPackageText);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const normalizedText = (text) => text.replaceAll("\r\n", "\n").replace(/\s+/g, " ").trim();

function sourceFile(declarations, declarationPath) {
  const source = ts.createSourceFile(declarationPath, declarations, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length > 0) {
    const details = source.parseDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")).join("; ");
    throw new Error(`Adobe AAFExportOptions declaration parse failed: ${details}`);
  }
  return source;
}

function typeLiteral(source, name) {
  const declaration = source.statements.find((statement) => (
    ts.isTypeAliasDeclaration(statement) && statement.name.text === name
  ));
  if (!declaration || !ts.isTypeLiteralNode(declaration.type)) {
    throw new Error(`Adobe declarations must expose ${name} as a type literal.`);
  }
  return declaration;
}

function propertyEntry(type, source, owner, name) {
  const member = type.members.find((candidate) => (
    ts.isPropertySignature(candidate) && candidate.name && ts.isIdentifier(candidate.name) && candidate.name.text === name
  ));
  if (!member || !member.type) {
    throw new Error(`Adobe declarations must expose ${owner}.${name} as a typed property.`);
  }
  return {
    symbol: `${owner}.${name}`,
    kind: "property",
    signature: normalizedText(member.type.getText(source)),
  };
}

function factoryEntries(type, source, owner) {
  const entries = type.members.filter((member) => (
    ts.isConstructSignatureDeclaration(member) || ts.isCallSignatureDeclaration(member)
  )).map((member) => {
    if (!member.type) throw new Error(`Adobe ${owner} factory signature is missing a return type.`);
    const signature = `(${member.parameters.map((parameter) => normalizedText(parameter.getText(source))).join(", ")}) => ${normalizedText(member.type.getText(source))}`;
    if (ts.isConstructSignatureDeclaration(member)) {
      return { symbol: `${owner}.new`, kind: "construct_signature", signature };
    }
    return { symbol: `${owner}.call`, kind: "call_signature", signature };
  }).sort((left, right) => compareText(left.symbol, right.symbol));
  if (entries.length !== 2 || entries[0].kind !== "call_signature" || entries[1].kind !== "construct_signature") {
    throw new Error(`Adobe ${owner} must expose exactly one call and one construct factory signature.`);
  }
  return entries;
}

function hasFactorySignatures(type) {
  return type.members.some((member) => (
    ts.isConstructSignatureDeclaration(member) || ts.isCallSignatureDeclaration(member)
  ));
}

function nonFactoryMembers(type, source, owner) {
  const members = type.members.filter((member) => (
    !ts.isConstructSignatureDeclaration(member) && !ts.isCallSignatureDeclaration(member)
  )).map((member) => normalizedText(member.getText(source))).sort(compareText);
  if (members.length === 0) throw new Error(`Adobe ${owner} must retain non-factory option members.`);
  return members;
}

function hasTypeAlias(source, name) {
  return source.statements.some((statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
}

function declarationHash(declaration, source) {
  return createHash("sha256").update(normalizedText(declaration.getText(source))).digest("hex");
}

const stableSource = sourceFile(stableDeclarations, stableDeclarationsPath);
const betaSource = sourceFile(betaDeclarations, betaDeclarationsPath);
const stableRoot = typeLiteral(stableSource, "premierepro");
const betaRoot = typeLiteral(betaSource, "premierepro");
const stableOptions = typeLiteral(stableSource, "AAFExportOptions");
const betaOptions = typeLiteral(betaSource, "AAFExportOptions");
const stableBinding = propertyEntry(stableRoot.type, stableSource, "premierepro", "AAFExportOptions");
const betaBinding = propertyEntry(betaRoot.type, betaSource, "premierepro", "AAFExportOptions");
if (stableBinding.signature !== "AAFExportOptions") {
  throw new Error("Pinned stable declarations must expose premierepro.AAFExportOptions as AAFExportOptions.");
}
if (betaBinding.signature !== "AAFExportOptionsStatic") {
  throw new Error("Adobe beta declarations must expose premierepro.AAFExportOptions as AAFExportOptionsStatic.");
}
if (hasTypeAlias(stableSource, "AAFExportOptionsStatic")) {
  throw new Error("Pinned stable declarations unexpectedly expose AAFExportOptionsStatic.");
}
const betaStatic = typeLiteral(betaSource, "AAFExportOptionsStatic");
const stableFactories = factoryEntries(stableOptions.type, stableSource, "AAFExportOptions");
const betaFactories = factoryEntries(betaStatic.type, betaSource, "AAFExportOptionsStatic");
const stableFactoryShapes = stableFactories.map(({ kind, signature }) => ({ kind, signature }));
const betaFactoryShapes = betaFactories.map(({ kind, signature }) => ({ kind, signature }));
if (JSON.stringify(stableFactoryShapes) !== JSON.stringify(betaFactoryShapes)) {
  throw new Error("Adobe beta AAFExportOptionsStatic factory signatures must match stable AAFExportOptions factory signatures.");
}
if (JSON.stringify(nonFactoryMembers(stableOptions.type, stableSource, "AAFExportOptions")) !==
  JSON.stringify(nonFactoryMembers(betaOptions.type, betaSource, "AAFExportOptions"))) {
  throw new Error("Adobe beta AAFExportOptions non-factory option members must match the pinned stable declaration.");
}
if (hasFactorySignatures(betaOptions.type)) {
  throw new Error("Adobe beta AAFExportOptions must not retain factory signatures after the static-type migration.");
}

const betaOnly = [
  {
    symbol: "AAFExportOptionsStatic",
    kind: "type",
    signature: normalizedText(betaStatic.type.getText(betaSource)),
  },
  ...betaFactories,
].sort((left, right) => compareText(left.symbol, right.symbol));

const inventory = {
  schemaVersion: 1,
  scope: {
    declarations: ["premierepro.AAFExportOptions", "AAFExportOptions", "AAFExportOptionsStatic"],
    semantics: "This records the beta AAFExportOptions factory-type migration against the pinned stable package. It is static declaration-drift accounting, not beta API support or a complete package diff.",
    mutationBoundary: "AAFExportOptions configures AAF export behavior. This receipt intentionally does not construct options, create an export action, or expose an MCP AAF-export operation.",
    doesNotEstablish: "It does not prove a beta host exposes the static factory, that an AAF export can be configured or completed, that export paths or effect settings are accepted, or that any MCP action is supported or licensed-host validated.",
  },
  sources: {
    stable: {
      package: "@adobe/premierepro",
      version: stablePackage.version,
      declarations: relative(root, stableDeclarationsPath).replaceAll("\\", "/"),
      rootDeclarationSha256: declarationHash(stableRoot, stableSource),
      optionsDeclarationSha256: declarationHash(stableOptions, stableSource),
      staticFactoryPresent: false,
    },
    beta: {
      package: "@adobe/premierepro-beta",
      version: betaPackage.version,
      declarations: relative(root, betaDeclarationsPath).replaceAll("\\", "/"),
      rootDeclarationSha256: declarationHash(betaRoot, betaSource),
      optionsDeclarationSha256: declarationHash(betaOptions, betaSource),
      staticDeclarationSha256: declarationHash(betaStatic, betaSource),
      staticFactoryPresent: true,
    },
  },
  diff: {
    betaOnly,
    stableOnly: [],
    changed: [
      {
        symbol: "premierepro.AAFExportOptions",
        stable: stableBinding,
        beta: betaBinding,
      },
      {
        symbol: "AAFExportOptions.factorySignatures",
        stable: { owner: "AAFExportOptions", entries: stableFactoryShapes },
        beta: { owner: "AAFExportOptionsStatic", entries: betaFactoryShapes },
      },
    ],
  },
};
const rendered = `${JSON.stringify(inventory, null, 2)}\n`;

if (validateOnly) {
  console.log(`Validated Adobe beta AAFExportOptions declaration drift: ${betaOnly.length} beta-only and 2 changed symbols.`);
} else if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current.replaceAll("\r\n", "\n") !== rendered) {
    console.error("Adobe beta AAFExportOptions declaration drift inventory is stale. Run npm run adobe:beta-aaf-export-options-drift.");
    process.exitCode = 1;
  } else {
    console.log(`Adobe beta AAFExportOptions declaration drift inventory is current: ${betaOnly.length} beta-only and 2 changed symbols.`);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote Adobe beta AAFExportOptions declaration drift inventory: ${betaOnly.length} beta-only and 2 changed symbols.`);
}
