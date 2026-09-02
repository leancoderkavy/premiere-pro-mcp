import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stablePackagePath = resolve(root, "node_modules/@adobe/premierepro/package.json");
const betaPackagePath = resolve(root, "node_modules/@adobe/premierepro-beta/package.json");
const stableDeclarationsPath = process.env.PREMIERE_BETA_MEDIA_STABLE_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_MEDIA_STABLE_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro/src/premierepro.d.ts");
const betaDeclarationsPath = process.env.PREMIERE_BETA_MEDIA_BETA_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_MEDIA_BETA_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro-beta/src/premierepro.d.ts");
const outputPath = process.env.PREMIERE_BETA_MEDIA_DRIFT_OUTPUT_PATH
  ? resolve(process.env.PREMIERE_BETA_MEDIA_DRIFT_OUTPUT_PATH)
  : resolve(root, "src/resources/adobe-beta-media-drift.json");
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

function memberName(member, source) {
  if (!member.name || !(
    ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name)
  )) {
    throw new Error(`Adobe Media declaration has an unsupported member name in ${source.fileName}`);
  }
  return member.name.text;
}

function mediaDeclaration(declarations, declarationPath) {
  const source = ts.createSourceFile(declarationPath, declarations, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length > 0) {
    const details = source.parseDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")).join("; ");
    throw new Error(`Adobe Media declaration parse failed: ${details}`);
  }
  const declaration = source.statements.find((statement) => (
    ts.isTypeAliasDeclaration(statement) && statement.name.text === "Media"
  ));
  if (!declaration || !ts.isTypeLiteralNode(declaration.type)) {
    throw new Error("Adobe declarations must expose Media as a type literal.");
  }
  const members = declaration.type.members.map((member) => {
    const name = memberName(member, source);
    if (ts.isMethodSignature(member)) {
      if (!member.type) throw new Error(`Adobe Media.${name} is missing a return type.`);
      return {
        symbol: `Media.${name}`,
        kind: "method",
        signature: `(${member.parameters.map((parameter) => normalizedText(parameter.getText(source))).join(", ")}) => ${normalizedText(member.type.getText(source))}`,
      };
    }
    if (ts.isPropertySignature(member)) {
      if (!member.type) throw new Error(`Adobe Media.${name} is missing a property type.`);
      const readonly = Boolean(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Readonly);
      return {
        symbol: `Media.${name}`,
        kind: "property",
        ...(readonly ? { readonly: true } : {}),
        signature: normalizedText(member.type.getText(source)),
      };
    }
    throw new Error(`Adobe Media.${name} has an unsupported declaration kind.`);
  }).sort((left, right) => compareText(left.symbol, right.symbol));
  if (new Set(members.map((member) => member.symbol)).size !== members.length) {
    throw new Error("Adobe Media declarations must not contain duplicate symbols.");
  }
  return {
    members,
    declarationSha256: createHash("sha256").update(normalizedText(declaration.getText(source))).digest("hex"),
  };
}

const stable = mediaDeclaration(stableDeclarations, stableDeclarationsPath);
const beta = mediaDeclaration(betaDeclarations, betaDeclarationsPath);
const stableBySymbol = new Map(stable.members.map((member) => [member.symbol, member]));
const betaBySymbol = new Map(beta.members.map((member) => [member.symbol, member]));
const betaOnly = beta.members.filter((member) => !stableBySymbol.has(member.symbol));
const stableOnly = stable.members.filter((member) => !betaBySymbol.has(member.symbol));
const changed = stable.members.flatMap((member) => {
  const betaMember = betaBySymbol.get(member.symbol);
  if (!betaMember || JSON.stringify(member) === JSON.stringify(betaMember)) return [];
  return [{ symbol: member.symbol, stable: member, beta: betaMember }];
});
const unchanged = stable.members.filter((member) => {
  const betaMember = betaBySymbol.get(member.symbol);
  return betaMember && JSON.stringify(member) === JSON.stringify(betaMember);
}).map((member) => member.symbol);

const inventory = {
  schemaVersion: 1,
  scope: {
    declaration: "Media",
    semantics: "This compares only the public Media declaration in the pinned stable and beta packages. It is a declaration-drift audit, not beta API support or a complete package diff.",
    doesNotEstablish: "It does not prove a beta host exposes these members, that a stable host accepts a beta call, or that any MCP action is supported or licensed-host validated.",
  },
  sources: {
    stable: {
      package: "@adobe/premierepro",
      version: stablePackage.version,
      declarations: relative(root, stableDeclarationsPath).replaceAll("\\", "/"),
      mediaDeclarationSha256: stable.declarationSha256,
    },
    beta: {
      package: "@adobe/premierepro-beta",
      version: betaPackage.version,
      declarations: relative(root, betaDeclarationsPath).replaceAll("\\", "/"),
      mediaDeclarationSha256: beta.declarationSha256,
    },
  },
  members: {
    stable: stable.members,
    beta: beta.members,
  },
  diff: {
    betaOnly,
    stableOnly,
    changed,
    unchanged,
  },
};
const rendered = `${JSON.stringify(inventory, null, 2)}\n`;

if (validateOnly) {
  console.log(`Validated Adobe Media declaration drift: ${betaOnly.length} beta-only and ${changed.length} changed symbols.`);
} else if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current.replaceAll("\r\n", "\n") !== rendered) {
    console.error("Adobe beta Media declaration drift inventory is stale. Run npm run adobe:beta-media-drift.");
    process.exitCode = 1;
  } else {
    console.log(`Adobe beta Media declaration drift inventory is current: ${betaOnly.length} beta-only and ${changed.length} changed symbols.`);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote Adobe beta Media declaration drift inventory: ${betaOnly.length} beta-only and ${changed.length} changed symbols.`);
}
