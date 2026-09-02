import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stablePackagePath = resolve(root, "node_modules/@adobe/premierepro/package.json");
const betaPackagePath = resolve(root, "node_modules/@adobe/premierepro-beta/package.json");
const stableDeclarationsPath = process.env.PREMIERE_BETA_TRANSCRIPT_STABLE_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_TRANSCRIPT_STABLE_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro/src/premierepro.d.ts");
const betaDeclarationsPath = process.env.PREMIERE_BETA_TRANSCRIPT_BETA_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_TRANSCRIPT_BETA_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro-beta/src/premierepro.d.ts");
const outputPath = process.env.PREMIERE_BETA_TRANSCRIPT_DRIFT_OUTPUT_PATH
  ? resolve(process.env.PREMIERE_BETA_TRANSCRIPT_DRIFT_OUTPUT_PATH)
  : resolve(root, "src/resources/adobe-beta-transcript-drift.json");
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
    throw new Error(`Adobe TranscriptStatic declaration parse failed: ${details}`);
  }
  return source;
}

function transcriptDeclaration(source) {
  const declaration = source.statements.find((statement) => (
    ts.isTypeAliasDeclaration(statement) && statement.name.text === "TranscriptStatic"
  ));
  if (!declaration || !ts.isTypeLiteralNode(declaration.type)) {
    throw new Error("Adobe declarations must expose TranscriptStatic as a type literal.");
  }
  return declaration;
}

function members(declaration, source) {
  const entries = declaration.type.members.map((member) => {
    if (!member.name || !(
      ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name)
    )) {
      throw new Error(`Adobe TranscriptStatic declaration has an unsupported member name in ${source.fileName}`);
    }
    if (!ts.isMethodSignature(member) || !member.type) {
      throw new Error(`Adobe TranscriptStatic.${member.name.text} must be a typed method signature.`);
    }
    return {
      symbol: `TranscriptStatic.${member.name.text}`,
      kind: "method",
      signature: `(${member.parameters.map((parameter) => normalizedText(parameter.getText(source))).join(", ")}) => ${normalizedText(member.type.getText(source))}`,
    };
  }).sort((left, right) => compareText(left.symbol, right.symbol));
  if (new Set(entries.map((entry) => entry.symbol)).size !== entries.length) {
    throw new Error("Adobe TranscriptStatic declarations must not contain duplicate symbols.");
  }
  return entries;
}

function declarationHash(declaration, source) {
  return createHash("sha256").update(normalizedText(declaration.getText(source))).digest("hex");
}

const stableSource = sourceFile(stableDeclarations, stableDeclarationsPath);
const betaSource = sourceFile(betaDeclarations, betaDeclarationsPath);
const stableDeclaration = transcriptDeclaration(stableSource);
const betaDeclaration = transcriptDeclaration(betaSource);
const stableMembers = members(stableDeclaration, stableSource);
const betaMembers = members(betaDeclaration, betaSource);
const stableBySymbol = new Map(stableMembers.map((member) => [member.symbol, member]));
const betaBySymbol = new Map(betaMembers.map((member) => [member.symbol, member]));
const betaOnly = betaMembers.filter((member) => !stableBySymbol.has(member.symbol));
const stableOnly = stableMembers.filter((member) => !betaBySymbol.has(member.symbol));
const changed = stableMembers.flatMap((member) => {
  const betaMember = betaBySymbol.get(member.symbol);
  if (!betaMember || JSON.stringify(member) === JSON.stringify(betaMember)) return [];
  return [{ symbol: member.symbol, stable: member, beta: betaMember }];
});

const inventory = {
  schemaVersion: 1,
  scope: {
    declaration: "TranscriptStatic",
    semantics: "This compares only the public TranscriptStatic declaration in the pinned stable and beta packages. It is static declaration-drift accounting, not beta API support or a complete package diff.",
    mutationBoundary: "transcribeClipProjectItem is a beta transcription-start operation. This receipt intentionally has no production call or user-facing transcription action.",
    doesNotEstablish: "It does not prove a beta host exposes either added member, that a language pack is installed or usable, that transcription starts or completes, that transcript content is safe to handle, or that any MCP action is supported or licensed-host validated.",
  },
  sources: {
    stable: {
      package: "@adobe/premierepro",
      version: stablePackage.version,
      declarations: relative(root, stableDeclarationsPath).replaceAll("\\", "/"),
      transcriptDeclarationSha256: declarationHash(stableDeclaration, stableSource),
    },
    beta: {
      package: "@adobe/premierepro-beta",
      version: betaPackage.version,
      declarations: relative(root, betaDeclarationsPath).replaceAll("\\", "/"),
      transcriptDeclarationSha256: declarationHash(betaDeclaration, betaSource),
    },
  },
  members: {
    stable: stableMembers,
    beta: betaMembers,
  },
  diff: {
    betaOnly,
    stableOnly,
    changed,
  },
};
const rendered = `${JSON.stringify(inventory, null, 2)}\n`;

if (validateOnly) {
  console.log(`Validated Adobe beta TranscriptStatic declaration drift: ${betaOnly.length} beta-only and ${changed.length} changed symbols.`);
} else if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current.replaceAll("\r\n", "\n") !== rendered) {
    console.error("Adobe beta TranscriptStatic declaration drift inventory is stale. Run npm run adobe:beta-transcript-drift.");
    process.exitCode = 1;
  } else {
    console.log(`Adobe beta TranscriptStatic declaration drift inventory is current: ${betaOnly.length} beta-only and ${changed.length} changed symbols.`);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote Adobe beta TranscriptStatic declaration drift inventory: ${betaOnly.length} beta-only and ${changed.length} changed symbols.`);
}
