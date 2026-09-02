import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stablePackagePath = resolve(root, "node_modules/@adobe/premierepro/package.json");
const betaPackagePath = resolve(root, "node_modules/@adobe/premierepro-beta/package.json");
const stableDeclarationsPath = process.env.PREMIERE_BETA_C2PA_STABLE_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_C2PA_STABLE_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro/src/premierepro.d.ts");
const betaDeclarationsPath = process.env.PREMIERE_BETA_C2PA_BETA_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_C2PA_BETA_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro-beta/src/premierepro.d.ts");
const outputPath = process.env.PREMIERE_BETA_C2PA_DRIFT_OUTPUT_PATH
  ? resolve(process.env.PREMIERE_BETA_C2PA_DRIFT_OUTPUT_PATH)
  : resolve(root, "src/resources/adobe-beta-c2pa-drift.json");
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
    throw new Error(`Adobe C2PA declaration parse failed: ${details}`);
  }
  return source;
}

function nameOf(member, source, owner) {
  if (!member.name || !(
    ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name)
  )) {
    throw new Error(`Adobe ${owner} declaration has an unsupported member name in ${source.fileName}`);
  }
  return member.name.text;
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

function constantsNamespace(source) {
  const declaration = source.statements.find((statement) => (
    ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name) && statement.name.text === "Constants"
  ));
  if (!declaration || !declaration.body || !ts.isModuleBlock(declaration.body)) {
    throw new Error("Adobe declarations must expose Constants as a module block.");
  }
  return declaration.body;
}

function enumEntries(source, name) {
  const declaration = constantsNamespace(source).statements.find((statement) => (
    ts.isEnumDeclaration(statement) && statement.name.text === name
  ));
  if (!declaration) throw new Error(`Adobe declarations must expose Constants.${name} as an enum.`);
  const entries = declaration.members.map((member, ordinal) => {
    if (!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name)) {
      throw new Error(`Adobe Constants.${name} has an unsupported enum member name.`);
    }
    if (member.initializer) {
      throw new Error(`Adobe Constants.${name}.${member.name.text} must retain an implicit enum initializer.`);
    }
    return {
      symbol: `Constants.${name}.${member.name.text}`,
      kind: "enum_member",
      declarationOrder: ordinal,
      initializer: "implicit",
    };
  });
  if (new Set(entries.map((entry) => entry.symbol)).size !== entries.length) {
    throw new Error(`Adobe Constants.${name} declarations must not contain duplicate enum members.`);
  }
  return { declaration, entries };
}

function hasTypeAlias(source, name) {
  return source.statements.some((statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
}

function hasConstantsEnum(source, name) {
  const constants = source.statements.find((statement) => (
    ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name) && statement.name.text === "Constants"
  ));
  return Boolean(constants?.body && ts.isModuleBlock(constants.body) && constants.body.statements.some((statement) => (
    ts.isEnumDeclaration(statement) && statement.name.text === name
  )));
}

function declarationHash(declaration, source) {
  return createHash("sha256").update(normalizedText(declaration.getText(source))).digest("hex");
}

const stableSource = sourceFile(stableDeclarations, stableDeclarationsPath);
const betaSource = sourceFile(betaDeclarations, betaDeclarationsPath);
const stableRoot = typeLiteral(stableSource, "premierepro");
const stableRootEntries = memberEntries(stableRoot.type, stableSource, "premierepro");
if (stableRootEntries.some((entry) => entry.symbol === "premierepro.C2PAService") ||
  hasTypeAlias(stableSource, "C2PAServiceStatic") ||
  hasTypeAlias(stableSource, "C2PAService") ||
  hasConstantsEnum(stableSource, "C2PAManifestLocation")) {
  throw new Error("Pinned stable declarations unexpectedly expose a C2PA surface.");
}

const betaRoot = typeLiteral(betaSource, "premierepro");
const rootBinding = memberEntries(betaRoot.type, betaSource, "premierepro")
  .find((entry) => entry.symbol === "premierepro.C2PAService");
if (!rootBinding || rootBinding.kind !== "property" || rootBinding.signature !== "C2PAServiceStatic") {
  throw new Error("Adobe beta declarations must expose premierepro.C2PAService as C2PAServiceStatic.");
}
const serviceStatic = typeLiteral(betaSource, "C2PAServiceStatic");
const serviceStaticEntries = memberEntries(serviceStatic.type, betaSource, "C2PAServiceStatic");
const serviceInstance = typeLiteral(betaSource, "C2PAService");
if (serviceInstance.type.members.length !== 0) {
  throw new Error("Adobe beta C2PAService instance declaration must remain empty for this receipt.");
}
const manifestLocations = enumEntries(betaSource, "C2PAManifestLocation");
const betaOnly = [
  rootBinding,
  {
    symbol: "C2PAService",
    kind: "type",
    signature: normalizedText(serviceInstance.type.getText(betaSource)),
  },
  ...serviceStaticEntries,
  ...manifestLocations.entries,
].sort((left, right) => compareText(left.symbol, right.symbol));

const inventory = {
  schemaVersion: 1,
  scope: {
    declarations: [
      "premierepro.C2PAService",
      "C2PAServiceStatic",
      "C2PAService",
      "Constants.C2PAManifestLocation",
    ],
    semantics: "This records the C2PA declaration surface that is absent from the pinned stable package and present in the pinned beta package. It is static declaration-drift accounting, not beta API support or a complete package diff.",
    enumValueBoundary: "C2PAManifestLocation members have implicit enum initializers. declarationOrder records source order only; this receipt does not establish runtime numeric flag values or manifest-location semantics.",
    doesNotEstablish: "It does not prove a beta host exposes C2PAService, that a stable host accepts a beta call, that a manifest can be read or validated, or that an MCP action is supported or licensed-host validated.",
  },
  sources: {
    stable: {
      package: "@adobe/premierepro",
      version: stablePackage.version,
      declarations: relative(root, stableDeclarationsPath).replaceAll("\\", "/"),
      c2paSurfacePresent: false,
    },
    beta: {
      package: "@adobe/premierepro-beta",
      version: betaPackage.version,
      declarations: relative(root, betaDeclarationsPath).replaceAll("\\", "/"),
      c2paSurfacePresent: true,
      rootDeclarationSha256: declarationHash(betaRoot, betaSource),
      serviceStaticDeclarationSha256: declarationHash(serviceStatic, betaSource),
      serviceDeclarationSha256: declarationHash(serviceInstance, betaSource),
      manifestLocationDeclarationSha256: declarationHash(manifestLocations.declaration, betaSource),
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
  console.log(`Validated Adobe beta C2PA declaration drift: ${betaOnly.length} beta-only symbols.`);
} else if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current.replaceAll("\r\n", "\n") !== rendered) {
    console.error("Adobe beta C2PA declaration drift inventory is stale. Run npm run adobe:beta-c2pa-drift.");
    process.exitCode = 1;
  } else {
    console.log(`Adobe beta C2PA declaration drift inventory is current: ${betaOnly.length} beta-only symbols.`);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote Adobe beta C2PA declaration drift inventory: ${betaOnly.length} beta-only symbols.`);
}
