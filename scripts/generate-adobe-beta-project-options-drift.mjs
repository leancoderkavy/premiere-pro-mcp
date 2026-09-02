import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stableDeclarationsPath = process.env.PREMIERE_BETA_PROJECT_OPTIONS_STABLE_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_PROJECT_OPTIONS_STABLE_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro/src/premierepro.d.ts");
const betaDeclarationsPath = process.env.PREMIERE_BETA_PROJECT_OPTIONS_BETA_DECLARATIONS_PATH
  ? resolve(process.env.PREMIERE_BETA_PROJECT_OPTIONS_BETA_DECLARATIONS_PATH)
  : resolve(root, "node_modules/@adobe/premierepro-beta/src/premierepro.d.ts");
const outputPath = process.env.PREMIERE_BETA_PROJECT_OPTIONS_DRIFT_OUTPUT_PATH
  ? resolve(process.env.PREMIERE_BETA_PROJECT_OPTIONS_DRIFT_OUTPUT_PATH)
  : resolve(root, "src/resources/adobe-beta-project-options-drift.json");
const check = process.argv.includes("--check");
const validateOnly = process.argv.includes("--validate-only");
const [stablePackageText, betaPackageText, stableText, betaText] = await Promise.all([
  readFile(resolve(root, "node_modules/@adobe/premierepro/package.json"), "utf8"),
  readFile(resolve(root, "node_modules/@adobe/premierepro-beta/package.json"), "utf8"),
  readFile(stableDeclarationsPath, "utf8"),
  readFile(betaDeclarationsPath, "utf8"),
]);
const normalize = (value) => value.replaceAll("\r\n", "\n").replace(/\s+/g, " ").trim();
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const hash = (node, source) => createHash("sha256").update(normalize(node.getText(source))).digest("hex");

function sourceFile(text, path) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Adobe project-options declaration parse failed: ${source.parseDiagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, " ")).join("; ")}`);
  return source;
}
function type(source, name) {
  const declaration = source.statements.find((item) => ts.isTypeAliasDeclaration(item) && item.name.text === name);
  if (!declaration || !ts.isTypeLiteralNode(declaration.type)) throw new Error(`Adobe declarations must expose ${name} as a type literal.`);
  return declaration;
}
function binding(rootDeclaration, source, name) {
  const member = rootDeclaration.type.members.find((item) => ts.isPropertySignature(item) && item.name && ts.isIdentifier(item.name) && item.name.text === name);
  if (!member?.type) throw new Error(`Adobe declarations must expose premierepro.${name} as a typed property.`);
  return { symbol: `premierepro.${name}`, kind: "property", signature: normalize(member.type.getText(source)) };
}
function factories(declaration, source, owner) {
  const values = declaration.type.members.filter((item) => ts.isConstructSignatureDeclaration(item) || ts.isCallSignatureDeclaration(item)).map((item) => {
    if (!item.type) throw new Error(`Adobe ${owner} factory signature is missing a return type.`);
    return {
      symbol: `${owner}.${ts.isConstructSignatureDeclaration(item) ? "new" : "call"}`,
      kind: ts.isConstructSignatureDeclaration(item) ? "construct_signature" : "call_signature",
      signature: `(${item.parameters.map((parameter) => normalize(parameter.getText(source))).join(", ")}) => ${normalize(item.type.getText(source))}`,
    };
  }).sort((left, right) => compare(left.symbol, right.symbol));
  if (values.length !== 2 || values[0].kind !== "call_signature" || values[1].kind !== "construct_signature") throw new Error(`Adobe ${owner} must expose exactly one call and one construct factory signature.`);
  return values;
}
function nonFactories(declaration, source, owner) {
  const values = declaration.type.members.filter((item) => !ts.isConstructSignatureDeclaration(item) && !ts.isCallSignatureDeclaration(item)).map((item) => normalize(item.getText(source))).sort(compare);
  if (!values.length) throw new Error(`Adobe ${owner} must retain non-factory option members.`);
  return values;
}
function hasFactories(declaration) {
  return declaration.type.members.some((item) => ts.isConstructSignatureDeclaration(item) || ts.isCallSignatureDeclaration(item));
}
function hasType(source, name) {
  return source.statements.some((item) => ts.isTypeAliasDeclaration(item) && item.name.text === name);
}

const stableSource = sourceFile(stableText, stableDeclarationsPath);
const betaSource = sourceFile(betaText, betaDeclarationsPath);
const stableRoot = type(stableSource, "premierepro");
const betaRoot = type(betaSource, "premierepro");
const names = ["OpenProjectOptions", "CloseProjectOptions"];
const records = names.map((name) => {
  const staticName = `${name}Static`;
  const stableOptions = type(stableSource, name);
  const betaOptions = type(betaSource, name);
  if (hasType(stableSource, staticName)) throw new Error(`Pinned stable declarations unexpectedly expose ${staticName}.`);
  const betaStatic = type(betaSource, staticName);
  const stableBinding = binding(stableRoot, stableSource, name);
  const betaBinding = binding(betaRoot, betaSource, name);
  if (stableBinding.signature !== name) throw new Error(`Pinned stable declarations must expose premierepro.${name} as ${name}.`);
  if (betaBinding.signature !== staticName) throw new Error(`Adobe beta declarations must expose premierepro.${name} as ${staticName}.`);
  const stableFactories = factories(stableOptions, stableSource, name);
  const betaFactories = factories(betaStatic, betaSource, staticName);
  const stableShapes = stableFactories.map(({ kind, signature }) => ({ kind, signature }));
  const betaShapes = betaFactories.map(({ kind, signature }) => ({ kind, signature }));
  if (JSON.stringify(stableShapes) !== JSON.stringify(betaShapes)) throw new Error(`Adobe beta ${staticName} factory signatures must match stable ${name}.`);
  if (JSON.stringify(nonFactories(stableOptions, stableSource, name)) !== JSON.stringify(nonFactories(betaOptions, betaSource, name))) throw new Error(`Adobe beta ${name} option members must match the pinned stable declaration.`);
  if (hasFactories(betaOptions)) throw new Error(`Adobe beta ${name} must not retain factory signatures after the static-type migration.`);
  return { name, staticName, stableBinding, betaBinding, stableShapes, betaFactories, stableOptions, betaOptions, betaStatic };
});
const betaOnly = records.flatMap((record) => [
  { symbol: record.staticName, kind: "type", signature: normalize(record.betaStatic.type.getText(betaSource)) },
  ...record.betaFactories,
]).sort((left, right) => compare(left.symbol, right.symbol));
const changed = records.flatMap((record) => [
  { symbol: `premierepro.${record.name}`, stable: record.stableBinding, beta: record.betaBinding },
  { symbol: `${record.name}.factorySignatures`, stable: { owner: record.name, entries: record.stableShapes }, beta: { owner: record.staticName, entries: record.stableShapes } },
]);
const inventory = {
  schemaVersion: 1,
  scope: {
    declarations: records.flatMap(({ name, staticName }) => [`premierepro.${name}`, name, staticName]),
    semantics: "This records the beta OpenProjectOptions and CloseProjectOptions factory-type migrations against the pinned stable package. It is static declaration-drift accounting, not beta API support or a complete package diff.",
    mutationBoundary: "These options configure project open and close behavior, including dialog, dirty-project, workspace, and quit controls. This receipt intentionally does not construct options or expose an MCP open/close project operation.",
    doesNotEstablish: "It does not prove a beta host exposes either static factory, that dialogs or dirty-project behavior can be safely controlled, that a project opens or closes, or that any MCP action is supported or licensed-host validated.",
  },
  sources: {
    stable: { package: "@adobe/premierepro", version: JSON.parse(stablePackageText).version, declarations: relative(root, stableDeclarationsPath).replaceAll("\\", "/"), rootDeclarationSha256: hash(stableRoot, stableSource), staticFactoriesPresent: false, options: Object.fromEntries(records.map((record) => [record.name, hash(record.stableOptions, stableSource)])) },
    beta: { package: "@adobe/premierepro-beta", version: JSON.parse(betaPackageText).version, declarations: relative(root, betaDeclarationsPath).replaceAll("\\", "/"), rootDeclarationSha256: hash(betaRoot, betaSource), staticFactoriesPresent: true, options: Object.fromEntries(records.map((record) => [record.name, { optionsDeclarationSha256: hash(record.betaOptions, betaSource), staticDeclarationSha256: hash(record.betaStatic, betaSource) }])) },
  },
  diff: { betaOnly, stableOnly: [], changed },
};
const rendered = `${JSON.stringify(inventory, null, 2)}\n`;
if (validateOnly) console.log(`Validated Adobe beta project-options declaration drift: ${betaOnly.length} beta-only and ${changed.length} changed symbols.`);
else if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current.replaceAll("\r\n", "\n") !== rendered) { console.error("Adobe beta project-options declaration drift inventory is stale. Run npm run adobe:beta-project-options-drift."); process.exitCode = 1; }
  else console.log(`Adobe beta project-options declaration drift inventory is current: ${betaOnly.length} beta-only and ${changed.length} changed symbols.`);
} else { await writeFile(outputPath, rendered); console.log(`Wrote Adobe beta project-options declaration drift inventory: ${betaOnly.length} beta-only and ${changed.length} changed symbols.`); }
