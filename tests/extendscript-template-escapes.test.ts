import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const singleBackslashRegexEscape = /(?<!\\)(?:\\\\)*\\([sdwSDWbB.()\[\]{}\/+*?|^-]|\$(?!\{))/g;

type EscapeFinding = { file: string; line: number; escape: string };

function generatedTemplateChunks(node: ts.Node, source: ts.SourceFile, chunks: Array<{ text: string; position: number }>) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    chunks.push({ text: node.rawText ?? node.text, position: node.getStart(source) + 1 });
    return;
  }
  if (ts.isTemplateExpression(node)) {
    chunks.push({ text: node.head.rawText ?? node.head.text, position: node.head.getStart(source) + 1 });
    for (const span of node.templateSpans) {
      chunks.push({ text: span.literal.rawText ?? span.literal.text, position: span.literal.getStart(source) + 1 });
      generatedTemplateChunks(span.expression, source, chunks);
    }
    return;
  }
  ts.forEachChild(node, (child) => generatedTemplateChunks(child, source, chunks));
}

function findLostRegexEscapes(file: string, contents: string): EscapeFinding[] {
  const source = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const generated: Array<{ text: string; position: number }> = [];
  function visit(node: ts.Node) {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      generatedTemplateChunks(node, source, generated);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  const findings: EscapeFinding[] = [];
  for (const chunk of generated) {
    singleBackslashRegexEscape.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = singleBackslashRegexEscape.exec(chunk.text)) !== null) {
      const location = source.getLineAndCharacterOfPosition(chunk.position + match.index);
      findings.push({ file, line: location.line + 1, escape: match[0] });
    }
  }
  return findings;
}

function sourceFiles(): string[] {
  const tools = readdirSync(join(root, "src", "tools"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(root, "src", "tools", name));
  const bridge = readdirSync(join(root, "src", "bridge"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(root, "src", "bridge", name));
  return [...tools, ...bridge];
}

describe("ExtendScript template regex escapes", () => {
  it("distinguishes a lost single backslash from a preserved doubled backslash", () => {
    expect(findLostRegexEscapes("fixture.ts", 'buildToolScript(`var bad = /\\s/;`);')).toHaveLength(1);
    expect(findLostRegexEscapes("fixture.ts", 'buildToolScript(`var good = /\\\\s/;`);')).toHaveLength(0);
  });

  it("finds a lost escape inside HELPERS as well as generated tool scripts", () => {
    expect(findLostRegexEscapes("fixture.ts", 'const HELPERS = `var bad = /\\d/;`;')).toHaveLength(1);
  });

  it("scans templates returned by helpers and module-level constants", () => {
    expect(findLostRegexEscapes("fixture.ts", 'function script() { return `var bad = /\\S/;`; }')).toHaveLength(1);
    expect(findLostRegexEscapes("fixture.ts", 'const SCRIPT = `var bad = /\\W/;`;')).toHaveLength(1);
  });

  it("catches backspace-producing word boundaries and other lost regex escapes", () => {
    expect(findLostRegexEscapes("fixture.ts", 'const SCRIPT = `if (/\\bword/.test(x)) {}`;')).toHaveLength(1);
    expect(findLostRegexEscapes("fixture.ts", 'const SCRIPT = `var bad = /\\(/;`;')).toHaveLength(1);
  });

  it("allows escaped template interpolation but catches an escaped dollar before text", () => {
    expect(findLostRegexEscapes("fixture.ts", 'const OK = `\\${literal}`;')).toHaveLength(0);
    expect(findLostRegexEscapes("fixture.ts", 'const BAD = `\\$x`;')).toHaveLength(1);
  });

  it("finds no regex escapes that a TypeScript template would consume", () => {
    const findings = sourceFiles().flatMap((file) => findLostRegexEscapes(file, readFileSync(file, "utf8")));
    expect(findings, findings.map((finding) => `${finding.file}:${finding.line}: ${finding.escape}`).join("\n")).toEqual([]);
  });
});
