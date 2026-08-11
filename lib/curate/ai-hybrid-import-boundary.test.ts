import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const FORBIDDEN = [
  "templates/store",
  "pick-template",
  "build-curated-document",
  "quick-visual-engine",
  "safe-selection",
  "shadow-selection",
  "getTemplateHtml",
  "listTemplates",
  "pickTemplate",
  "pickWeighted",
  "runSkeletonCandidate",
  "fillAndNormalizeCuratedTemplate",
  "weightedFallback",
] as const;

interface ModuleReference {
  specifier: string;
  symbols: string[];
}

function moduleReferences(source: string, fileName: string): ModuleReference[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references: ModuleReference[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const symbols: string[] = [];
      const clause = node.importClause;
      if (clause?.name) symbols.push(clause.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        symbols.push(...clause.namedBindings.elements.map((element) => element.propertyName?.text ?? element.name.text));
      }
      references.push({ specifier: node.moduleSpecifier.text, symbols });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const symbols = node.exportClause && ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements.map((element) => element.propertyName?.text ?? element.name.text)
        : [];
      references.push({ specifier: node.moduleSpecifier.text, symbols });
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      references.push({ specifier: node.arguments[0].text, symbols: [] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function resolveRepositoryModule(root: string, importer: string, specifier: string): string | null {
  const unresolved = specifier.startsWith("@/")
    ? path.resolve(root, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(importer), specifier)
      : null;
  if (!unresolved) return null;

  const withoutJs = unresolved.replace(/\.(?:mjs|cjs|js|jsx)$/, "");
  for (const candidate of [
    unresolved,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    path.join(withoutJs, "index.ts"),
    path.join(withoutJs, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function findForbiddenDependencies(root: string, entry: string): string[] {
  const pending = [path.resolve(entry)];
  const visited = new Set<string>();
  const violations = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const source = fs.readFileSync(current, "utf8");
    for (const reference of moduleReferences(source, current)) {
      const resolved = resolveRepositoryModule(root, current, reference.specifier);
      if (!resolved || !resolved.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
      const forbidden = FORBIDDEN.some((name) => (
        reference.specifier.includes(name)
        || reference.symbols.includes(name)
      ));
      if (forbidden) {
        violations.add(path.relative(root, resolved).replaceAll(path.sep, "/"));
      }
      pending.push(resolved);
    }
  }
  return [...violations].sort();
}

describe("AI hybrid production import boundary", () => {
  it("detects forbidden transitive static, re-export, and dynamic imports", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-hybrid-import-"));
    try {
      fs.writeFileSync(path.join(root, "entry.ts"), 'import "./middle"; void import("./dynamic");');
      fs.writeFileSync(path.join(root, "middle.ts"), 'export { getTemplateHtml } from "./clone";');
      fs.writeFileSync(path.join(root, "dynamic.ts"), 'import { pickWeighted } from "./picker";');
      fs.writeFileSync(path.join(root, "clone.ts"), "export const getTemplateHtml = () => '';\n");
      fs.writeFileSync(path.join(root, "picker.ts"), "export const pickWeighted = () => '';\n");

      expect(findForbiddenDependencies(root, path.join(root, "entry.ts"))).toEqual([
        "clone.ts",
        "picker.ts",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps whole-template delivery outside the production Quick graph", () => {
    const root = process.cwd();
    expect(findForbiddenDependencies(
      root,
      path.join(root, "app", "api", "curate", "route.ts"),
    )).toEqual([]);
  });
});
