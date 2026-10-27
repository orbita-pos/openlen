// The «@» entries of an app: every JSX element in /src, from the SOURCE (spec
// local 2026-10-27, §6.2) — also the ones on screens nobody opened and behind
// conditions. Parsed with TypeScript (parse only, no type checking); sucrase
// keeps lines, so the line of each opening tag here is the `lineNumber` the
// compiler stamps on it in development (`lib/apps/compilador.ts`), which is
// what the Design mode reads back from the canvas.
import "server-only";

import type * as TS from "typescript";

import { humanNameOf, kindOf } from "./naming";
import type { MentionAttrs, MentionEntry } from "./types";

type TypeScript = typeof TS;

const SOURCE = /^\/src\/.+\.(jsx|tsx|js|ts)$/;
const TEST = /\.(test|spec)\.[jt]sx?$/;
const UI = "/src/components/ui/";
const TEXT_MAX = 120;
const TARGET_TEXT_MAX = 40;

const ATTRS: Readonly<Record<string, keyof MentionAttrs>> = {
  className: "className",
  id: "id",
  alt: "alt",
  "aria-label": "ariaLabel",
  title: "title",
  placeholder: "placeholder",
};

let loaded: Promise<TypeScript> | null = null;
function typescript(): Promise<TypeScript> {
  loaded ??= import("typescript").then((m) => ((m as unknown as { default?: TypeScript }).default ?? m) as TypeScript);
  return loaded;
}

function isOutlined(path: string): boolean {
  return SOURCE.test(path) && !TEST.test(path) && !path.startsWith("/src/test/") && !path.startsWith("/tests/");
}

function componentOf(ts: TypeScript, node: TS.Node): string | null {
  for (let n: TS.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text)) return n.name.text;
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name) && /^[A-Z]/.test(n.parent.name.text)) {
      return n.parent.name.text;
    }
  }
  return null;
}

export async function outlineFile(path: string, source: string): Promise<MentionEntry[]> {
  const ts = await typescript();
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : path.endsWith(".js") ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const entries: MentionEntry[] = [];

  const visit = (node: TS.Node, parentKey: string | null) => {
    let ownKey = parentKey;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(sf);
      const at = sf.getLineAndCharacterOfPosition(opening.getStart(sf));
      const line = at.line + 1;
      const attrs: MentionAttrs = {};
      let role: string | null = null;
      for (const p of opening.attributes.properties) {
        if (!ts.isJsxAttribute(p) || !p.initializer || !ts.isStringLiteral(p.initializer)) continue;
        const name = p.name.getText(sf);
        if (name === "role") role = p.initializer.text;
        const field = ATTRS[name];
        if (field) attrs[field] = p.initializer.text;
      }
      const ownText = ts.isJsxElement(node)
        ? node.children.filter(ts.isJsxText).map((c) => c.text).join(" ").replace(/\s+/g, " ").trim()
        : "";
      const component = componentOf(ts, node);
      const key = `${path}:${line}:${at.character + 1}`;
      entries.push({
        key,
        ruta: path,
        line,
        endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
        tag,
        kind: kindOf(tag, attrs, role),
        name: humanNameOf({ tag, ownText, attrs, component }),
        text: ownText.slice(0, TEXT_MAX),
        attrs,
        component,
        parent: parentKey,
        collapsed: false,
        target: { type: "app", path, line, tag, ...(ownText ? { text: ownText.slice(0, TARGET_TEXT_MAX) } : {}) },
      });
      ownKey = key;
    }
    ts.forEachChild(node, (child) => visit(child, ownKey));
  };

  visit(sf, null);
  return entries;
}

export async function outlineApp(files: Readonly<Record<string, string>>): Promise<MentionEntry[]> {
  const paths = Object.keys(files).filter(isOutlined).sort();
  // shadcn's components/ui go after everything else: what the user wrote first.
  const ordered = [...paths.filter((p) => !p.startsWith(UI)), ...paths.filter((p) => p.startsWith(UI))];
  const out: MentionEntry[] = [];
  for (const p of ordered) out.push(...(await outlineFile(p, files[p]!)));
  return out;
}
