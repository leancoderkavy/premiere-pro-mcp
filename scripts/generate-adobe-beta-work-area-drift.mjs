import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stablePackagePath = resolve(root, "node_modules/@adobe/premierepro/package.json");
const betaPackagePath = resolve(root, "node_modules/@adobe/premierepro-beta/package.json");
const stableDeclarationsPath = process.env.PREMIERE_BETA_WORK_AREA_STABLE_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_WORK_AREA_STABLE_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro/src/premierepro.d.ts");
const betaDeclarationsPath = process.env.PREMIERE_BETA_WORK_AREA_BETA_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_WORK_AREA_BETA_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro-beta/src/premierepro.d.ts");
const outputPath = process.env.PREMIERE_BETA_WORK_AREA_DRIFT_OUTPUT_PATH
  ? resolve(process.env.PREMIERE_BETA_WORK_AREA_DRIFT_OUTPUT_PATH)
  : resolve(root, "src/resources/adobe-beta-work-area-drift.json");
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
    throw new Error(`Adobe WorkAreaUtils declaration parse failed: ${details}`);
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

function nameOf(member, source, owner) {
  if (!member.name || !(
    ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name)
  )) {
    throw new Error(`Adobe ${owner} declaration has an unsupported member name in ${source.fileName}`);
  }
  return member.name.text;
}

function memberEntries(type, source, owner) {
  const entries = type.members.map((member) => {
    const name = nameOf(member, source, owner);
    if (ts.isMethodSignature(member)) {
      if (!member.type) throw new Error(`Adobe ${owner}.${name} is missing a return type.`);
      return {
        symbol: `${owner}.${name}`,
        kind: "method",
        signature: `(${member.parameters.map((parameter) => normalizedText(parameter.getText(source))).join(", ")}) => ${normalizedText(member.type.getText(source))}`,
      };
    }
    if (ts.isPropertySignature(member)) {
      if (!member.type) throw new Error(`Adobe ${owner}.${name} is missing a property type.`);
      const readonly = Boolean(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Readonly);
      return {
        symbol: `${owner}.${name}`,
        kind: "property",
        ...(readonly ? { readonly: true } : {}),
        signature: normalizedText(member.type.getText(source)),
      };
    }
    throw new Error(`Adobe ${owner}.${name} has an unsupported declaration kind.`);
  }).sort((left, right) => compareText(left.symbol, right.symbol));
  if (new Set(entries.map((entry) => entry.symbol)).size !== entries.length) {
    throw new Error(`Adobe ${owner} declarations must not contain duplicate symbols.`);
  }
  return entries;
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
const stableRootEntries = memberEntries(stableRoot.type, stableSource, "premierepro");
if (stableRootEntries.some((entry) => entry.symbol === "premierepro.WorkAreaUtils") ||
  hasTypeAlias(stableSource, "WorkAreaUtilsStatic") ||
  hasTypeAlias(stableSource, "WorkAreaUtils")) {
  throw new Error("Pinned stable declarations unexpectedly expose WorkAreaUtils.");
}

const betaRoot = typeLiteral(betaSource, "premierepro");
const rootBinding = memberEntries(betaRoot.type, betaSource, "premierepro")
  .find((entry) => entry.symbol === "premierepro.WorkAreaUtils");
if (!rootBinding || rootBinding.kind !== "property" || rootBinding.signature !== "WorkAreaUtilsStatic") {
  throw new Error("Adobe beta declarations must expose premierepro.WorkAreaUtils as WorkAreaUtilsStatic.");
}
const workAreaStatic = typeLiteral(betaSource, "WorkAreaUtilsStatic");
const workAreaEntries = memberEntries(workAreaStatic.type, betaSource, "WorkAreaUtilsStatic");
const workAreaInstance = typeLiteral(betaSource, "WorkAreaUtils");
if (workAreaInstance.type.members.length !== 0) {
  throw new Error("Adobe beta WorkAreaUtils instance declaration must remain empty for this receipt.");
}
const betaOnly = [
  rootBinding,
  {
    symbol: "WorkAreaUtils",
    kind: "type",
    signature: normalizedText(workAreaInstance.type.getText(betaSource)),
  },
  ...workAreaEntries,
].sort((left, right) => compareText(left.symbol, right.symbol));

const inventory = {
  schemaVersion: 1,
  scope: {
    declarations: ["premierepro.WorkAreaUtils", "WorkAreaUtilsStatic", "WorkAreaUtils"],
    semantics: "This records the WorkAreaUtils declaration surface that is absent from the pinned stable package and present in the pinned beta package. It is static declaration-drift accounting, not beta API support or a complete package diff.",
    doesNotEstablish: "It does not prove a beta host exposes WorkAreaUtils, that a stable host accepts a beta call, that any work-area mutation changes a sequence, or that an MCP action is supported or licensed-host validated.",
    existingToolBoundary: "Existing MCP work-area tools use established legacy host paths. This receipt neither changes those implementations nor establishes that they are equivalent to beta WorkAreaUtils behavior.",
  },
  sources: {
    stable: {
      package: "@adobe/premierepro",
      version: stablePackage.version,
      declarations: relative(root, stableDeclarationsPath).replaceAll("\\", "/"),
      workAreaSurfacePresent: false,
    },
    beta: {
      package: "@adobe/premierepro-beta",
      version: betaPackage.version,
      declarations: relative(root, betaDeclarationsPath).replaceAll("\\", "/"),
      workAreaSurfacePresent: true,
      rootDeclarationSha256: declarationHash(betaRoot, betaSource),
      workAreaStaticDeclarationSha256: declarationHash(workAreaStatic, betaSource),
      workAreaDeclarationSha256: declarationHash(workAreaInstance, betaSource),
    },
  },
  diff: {
    betaOnly,
    stableOnly: [],
    changed: [],
  },
};
const rendered = `${JSON.stringify(inventory, null, 2)}\n`;

if (validateOnly) {
  console.log(`Validated Adobe beta WorkAreaUtils declaration drift: ${betaOnly.length} beta-only symbols.`);
} else if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current.replaceAll("\r\n", "\n") !== rendered) {
    console.error("Adobe beta WorkAreaUtils declaration drift inventory is stale. Run npm run adobe:beta-work-area-drift.");
    process.exitCode = 1;
  } else {
    console.log(`Adobe beta WorkAreaUtils declaration drift inventory is current: ${betaOnly.length} beta-only symbols.`);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote Adobe beta WorkAreaUtils declaration drift inventory: ${betaOnly.length} beta-only symbols.`);
}
