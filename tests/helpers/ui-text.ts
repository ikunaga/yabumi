// 画面の文を src から集める（tests/ui-wording.test.ts が使う。決まりは docs/design/ui-writing.md）。
// TypeScript の構文木を読み、日本語を含む文字列と JSX の文を「文のまとまり」として返す。
// 1 つの要素の中で文字と {式} が並んでいるときは、{式} を「{…}」にして 1 つにつなぐ（<Term> などの中の文字もつなぐ）
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export type UiText = { file: string; line: number; text: string };

// 対象外: 法務の文（規約・プライバシーポリシーと、その版の変更の知らせ）
const SKIP_DIRS = ["src/app/privacy", "src/app/terms", "src/lib/legal"];
// 対象外: AI の書いた文を調べるための言い回しの一覧（画面には出ない）
const SKIP_FILES = ["src/lib/ai/japanese-style.ts"];
// 対象外: AI に送る指示の文。名前が次の形の定数・関数の中の文字列は、画面に出ない前提で読まない
//   〜_SYSTEM・〜_RULE(S)・〜PROMPT・〜Prompt・〜Request・〜Schema・〜Context〜・build〜
const AI_NAME = /SYSTEM|_RULES?$|^[A-Z_]*RULES?$|PROMPT|Prompt|Request|[Ss]chema$|Context|^build[A-Z]/;
// これ以外で画面に出ない文字列は、前の行か同じ行に「ui-wording-ignore: 理由」と書く。
// ファイルごと外すときは、ファイルの先頭 5 行のどこかに「ui-wording-ignore-file: 理由」と書く
const IGNORE_LINE = "ui-wording-ignore";
const IGNORE_FILE = "ui-wording-ignore-file";

// 文の中にそのまま入る要素（ここの中の文字は、外の文とつなぐ）
const INLINE_TAGS = new Set(["span", "strong", "b", "em", "a", "code", "small", "kbd", "Term", "Link"]);
const JA = /[぀-ヿ㐀-鿿]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP_DIRS.includes(path) ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") && !SKIP_FILES.includes(path) ? [path] : [];
  });
}

function tagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText();
}

// 文字列が画面に出ないところ（比べる・探す・キーにする・ログに出す）にあるか
function notShown(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)) return true;
  if (ts.isElementAccessExpression(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isCallExpression(parent) && parent.arguments.includes(node as ts.Expression)) {
    const callee = parent.expression.getText();
    if (/^console\.|\.(includes|startsWith|endsWith|indexOf|test|match|replace|replaceAll|split|has|get)$/.test(callee) || callee === "RegExp") return true;
  }
  if (ts.isNewExpression(parent) && parent.expression.getText() === "RegExp") return true;
  return false;
}

function insideAiText(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n)) && n.name && AI_NAME.test(n.name.getText())) return true;
  }
  return false;
}

function stringText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => "{…}" + s.literal.text).join("");
  return null;
}

// JSX の子をつないだ文。インラインの要素は中までつなぐ。ブロックの要素が来たら、そこで文を切る
function jsxRuns(children: ts.NodeArray<ts.JsxChild>, runs: string[][]): void {
  let current: string[] = [];
  const flush = () => {
    if (current.length) runs.push(current);
    current = [];
  };
  const walk = (list: ts.NodeArray<ts.JsxChild>) => {
    for (const child of list) {
      if (ts.isJsxText(child)) current.push(child.text.replace(/\s+/g, " "));
      else if (ts.isJsxExpression(child)) {
        if (!child.expression) continue;
        const s = stringText(child.expression);
        current.push(s === null ? "{…}" : s.replace(/\n/g, "⏎"));
      } else if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && INLINE_TAGS.has(tagName(child))) {
        if (ts.isJsxElement(child)) walk(child.children);
        else current.push("{…}");
      } else {
        flush();
      }
    }
  };
  walk(children);
  flush();
}

export function collectUiTexts(root = "src"): UiText[] {
  const out: UiText[] = [];
  for (const file of sourceFiles(root)) {
    const source = readFileSync(file, "utf8");
    if (source.split("\n").slice(0, 5).some((l) => l.includes(IGNORE_FILE))) continue;
    const lines = source.split("\n");
    const ignored = (line: number) => lines[line - 1]?.includes(IGNORE_LINE) || lines[line - 2]?.includes(IGNORE_LINE);
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const push = (node: ts.Node, text: string) => {
      const t = text.replace(/\s+/g, " ").trim();
      if (!JA.test(t)) return;
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (ignored(line) || insideAiText(node)) return;
      out.push({ file, line, text: t });
    };
    // JSX の要素の中で、つないで読んだ文字列（あとで二重に数えないため）
    const done = new Set<ts.Node>();
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && !INLINE_TAGS.has(tagName(node))) {
        const runs: string[][] = [];
        jsxRuns(node.children, runs);
        for (const run of runs) push(node, run.join(""));
        const mark = (list: ts.NodeArray<ts.JsxChild>) => {
          for (const c of list) {
            if (ts.isJsxExpression(c) && c.expression && stringText(c.expression) !== null) done.add(c.expression);
            if (ts.isJsxElement(c) && INLINE_TAGS.has(tagName(c))) mark(c.children);
          }
        };
        mark(node.children);
      } else if (!done.has(node) && !ts.isJsxText(node)) {
        const s = stringText(node);
        if (s !== null) {
          if (!notShown(node)) push(node, s.replace(/\n/g, "⏎"));
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

// 文に分ける（。！？と改行で切る）
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n|⏎/)
    .map((s) => s.trim())
    .filter((s) => JA.test(s));
}

// 1 文の長さ。空白は数えず、{…}（あとで入る言葉）は 2 字に数える
export function sentenceLength(sentence: string): number {
  return sentence.replace(/\{…\}/g, "〇〇").replace(/\s/g, "").length;
}

export const MAX_SENTENCE = 40;

// かっこ書きの補足（全角のかっこと、日本語を含む半角のかっこ）
export function parentheticals(text: string): string[] {
  return [...text.matchAll(/（[^（）]*）|\([^()]*[぀-ヿ㐀-鿿][^()]*\)/g)].map((m) => m[0]);
}
