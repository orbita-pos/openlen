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
const FORBIDDEN_GEMINI_CREATE_SYMBOLS = [
  "GeminiProvider",
  "createGeminiSectionSpecProvider",
  "critiqueVisualQuality",
  "generateVisualRepairPlan",
] as const;
const FORBIDDEN_GEMINI_CREATE_MODULES = [
  "analyze-intent",
  "generate-page-copy",
  "gemini-section-spec-provider",
  "visual-quality-critic",
  "generate-visual-repair",
] as const;

interface ModuleReference {
  specifier: string;
  symbols: string[];
  typeOnly: boolean;
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
      references.push({ specifier: node.moduleSpecifier.text, symbols, typeOnly: clause?.isTypeOnly === true });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const symbols = node.exportClause && ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements.map((element) => element.propertyName?.text ?? element.name.text)
        : [];
      references.push({ specifier: node.moduleSpecifier.text, symbols, typeOnly: node.isTypeOnly });
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      references.push({ specifier: node.arguments[0].text, symbols: [], typeOnly: false });
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
      if (!reference.typeOnly) pending.push(resolved);
    }
  }
  return [...violations].sort();
}

function findReachableModules(root: string, entry: string): string[] {
  const pending = [path.resolve(entry)];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const source = fs.readFileSync(current, "utf8");
    for (const reference of moduleReferences(source, current)) {
      if (reference.typeOnly) continue;
      const resolved = resolveRepositoryModule(root, current, reference.specifier);
      if (resolved?.startsWith(`${path.resolve(root)}${path.sep}`)) pending.push(resolved);
    }
  }
  return [...visited].map((file) => path.relative(root, file).replaceAll(path.sep, "/")).sort();
}

function findGeminiTextOrVisionDependencies(root: string, entry: string): string[] {
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
      if (!reference.typeOnly && (FORBIDDEN_GEMINI_CREATE_MODULES.some((moduleName) => reference.specifier.includes(moduleName))
        || FORBIDDEN_GEMINI_CREATE_SYMBOLS.some((symbol) => reference.symbols.includes(symbol)))) {
        violations.add(path.relative(root, resolved).replaceAll(path.sep, "/"));
      }
      if (!reference.typeOnly) pending.push(resolved);
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

  it("detects the retired Gemini-backed intent and page-copy module paths transitively", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-hybrid-gemini-text-"));
    try {
      fs.writeFileSync(path.join(root, "entry.ts"), 'import "./middle";');
      fs.writeFileSync(path.join(root, "middle.ts"), 'import "./analyze-intent"; import "./generate-page-copy";');
      fs.writeFileSync(path.join(root, "analyze-intent.ts"), "export const retiredIntent = true;\n");
      fs.writeFileSync(path.join(root, "generate-page-copy.ts"), "export const retiredCopy = true;\n");

      expect(findGeminiTextOrVisionDependencies(root, path.join(root, "entry.ts"))).toEqual([
        "analyze-intent.ts",
        "generate-page-copy.ts",
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

  it("keeps Gemini text and vision providers outside Create with AI while retaining image-only assets", () => {
    const root = process.cwd();
    expect(findGeminiTextOrVisionDependencies(root, path.join(root, "app", "api", "curate", "route.ts"))).toEqual([]);
    const geminiModules = findReachableModules(root, path.join(root, "app", "api", "curate", "route.ts"))
      .filter((moduleName) => /(?:^|\/)gemini-[^/]+\.ts$/.test(moduleName));
    expect(geminiModules).toEqual(["lib/generation/gemini-asset-pack-provider.ts"]);
    expect(fs.readFileSync(path.join(root, geminiModules[0]!), "utf8")).toMatch(/responseModalities:\s*\["IMAGE"\]/);
  });
});

// La puerta de generación no manda nada nuestro. Ha vuelto por dos puertas
// distintas en un solo día: cinco fragmentos de HTML de Mirror dentro de la
// guía de diseño, y la captura de una plantilla curada adjunta al brief con un
// "iguala su calidad, densidad y espaciado". Esta segunda además desviaba el
// turno a Gemini sin decirlo, porque una imagen adjunta lo exige.
describe("la puerta de generación no alcanza plantillas ni secciones", () => {
  const ENTRY = ["app", "api", "generate", "route.ts"] as const;

  // El invariante es que NINGUNA plantilla curada pueda llegarle al modelo, no
  // que el árbol no toque nada bajo templates/: el almacén sigue alcanzable por
  // la maquinaria de capturas y metadatos, que no manda contenido de página a
  // ningún sitio. Lo que se prohíbe es el selector de referencia y el HTML.
  it("no llega al selector de plantilla de referencia", () => {
    const root = process.cwd();
    const offenders = findReachableModules(root, path.join(root, ...ENTRY))
      .filter((moduleName) => /templates\/select-reference\.ts$/.test(moduleName));
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });

  it("no llega al catálogo de secciones", () => {
    const root = process.cwd();
    const offenders = findReachableModules(root, path.join(root, ...ENTRY))
      .filter((moduleName) => /sections\/(store|select)\.ts$/.test(moduleName));
    expect(offenders).toEqual([]);
  });
});
