// THE «SELECTS EVERYTHING» GATE (spec local 2026-10-27, §9). For every document,
// in Chromium:
//   1. every element you can click on the canvas has an index entry;
//   2. every index entry that is on screen outlines that same element;
//   3. a mention built from an entry anchors on the server to that element's lines;
//   4. an entry with visible text is in the top 5 when you search for that text.
// A failure that belongs to a known class of §6.10 says so; any other is a bug.
// Test and script only (it launches Chromium and loads jsdom).
import { createServer } from "node:http";

import { buildEditPath, elementAtEditPath, mentionSignatureMatches } from "@/components/workspace-v2/edit-path";
import { injectDesignMode } from "@/components/workspace-v2/design-mode/inject-design-mode";
import { decl } from "@/components/workspace-v2/serializar-al-iframe";
import { etiquetarConPosiciones } from "@/lib/agent/ficheros/posiciones";
import { bundleApp } from "@/lib/apps/bundler/bundle-app";
import { primaryOf, sourceChainOf } from "@/lib/apps/design/canvas-functions";
import { entradaServida } from "@/lib/apps/servir";
import type { AppDeProyecto } from "@/lib/projects/types";

import { outlineApp } from "./app-outline";
import { buildPageEntries } from "./page-entries";
import { resolveMentions } from "./resolve";
import { searchMentions } from "./search";
import type { MentionEntry, MentionRef } from "./types";

export type KnownClass = "script-created" | "library-created" | "duplicate-text" | "canvas" | "embed" | "svg-internal" | "shadow-dom";

export type GateDoc =
  | { name: string; kind: "page"; html: string }
  | { name: string; kind: "app"; files: Readonly<Record<string, string>>; app: AppDeProyecto; shell: string };

export interface GateFailure {
  check: 1 | 2 | 3 | 4;
  key: string;
  reason: string;
  knownClass: KnownClass | null;
}

export interface GateReport {
  docs: { name: string; checked: number; failures: GateFailure[] }[];
}

const SKIPPED_TAGS = ["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META", "BR", "HR", "SOURCE", "TRACK"];

type Browser = import("puppeteer").Browser;

async function launch(): Promise<Browser> {
  const { default: puppeteer } = await import("puppeteer");
  return puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
}

async function parseWithJsdom(html: string): Promise<Document> {
  const { JSDOM } = await import("jsdom");
  return new JSDOM(html).window.document;
}

function refOf(e: MentionEntry): MentionRef {
  return { type: "element", label: `@${e.name}`, text: e.text.slice(0, 40), target: e.target };
}

function fold(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Check 4, the same for pages and apps. */
function searchFailures(entries: readonly MentionEntry[]): GateFailure[] {
  const sameText = new Map<string, number>();
  for (const e of entries) if (e.text) sameText.set(fold(e.text), (sameText.get(fold(e.text)) ?? 0) + 1);
  const out: GateFailure[] = [];
  for (const e of entries) {
    if (!e.text) continue;
    const found = searchMentions(entries, [], e.text, 5).items.some((i) => i.type === "element" && i.entry.key === e.key);
    if (!found) {
      out.push({ check: 4, key: e.key, reason: `not in the top 5 for «${e.text.slice(0, 40)}»`, knownClass: (sameText.get(fold(e.text)) ?? 0) >= 5 ? "duplicate-text" : null });
    }
  }
  return out;
}

const PAGE_PROBE = `
${decl("buildEditPath", buildEditPath)}
${decl("elementAtEditPath", elementAtEditPath)}
${decl("mentionSignatureMatches", mentionSignatureMatches)}
var SKIPPED = ${JSON.stringify(SKIPPED_TAGS)};
function shown(el) { var r = el.getBoundingClientRect(); var cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; }
function ownText(el) { var s = ''; for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) s += ' ' + (n.textContent || ''); return s.replace(/\\s+/g, ' ').trim().slice(0, 40); }
`;

async function gatePage(browser: Browser, doc: { name: string; html: string }): Promise<{ checked: number; failures: GateFailure[] }> {
  const tagged = etiquetarConPosiciones(doc.html);
  const source = await parseWithJsdom(tagged);
  const index = buildPageEntries(tagged, null, "/index.html", () => source);
  const byPath = new Map(index.map((e) => [(e.target as { path: string }).path, e]));
  const failures: GateFailure[] = [];

  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (r) => void (r.url().startsWith("data:") || r.url() === "about:blank" ? r.continue() : r.abort()));
    await page.setViewport({ width: 1280, height: 900 });
    await page.setContent(doc.html, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.addScriptTag({ content: PAGE_PROBE });
    // 1. what can be clicked
    const clickable = (await page.evaluate(`(function () {
      var out = [], seen = {};
      var all = document.body ? document.body.getElementsByTagName('*') : [];
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (SKIPPED.indexOf(el.tagName) !== -1 || !shown(el)) continue;
        var svg = el.closest && el.closest('svg');
        if (svg && svg !== el) continue;
        var p = buildEditPath(el);
        if (seen[p]) continue;
        seen[p] = 1;
        out.push({ path: p, tag: el.tagName.toLowerCase(), text: ownText(el) });
      }
      return out;
    })()`)) as { path: string; tag: string; text: string }[];
    for (const c of clickable) {
      if (byPath.has(c.path)) continue;
      const inSource = source.body ? elementAtEditPath(c.path, source.body) : null;
      const fromScript = !inSource || !mentionSignatureMatches(inSource, c.tag, c.text || undefined);
      failures.push({ check: 1, key: c.path, reason: `<${c.tag}> «${c.text}» has no entry`, knownClass: fromScript ? "script-created" : null });
    }
    // 2. what the index outlines
    const probes = index.map((e) => ({ key: e.key, path: (e.target as { path: string }).path, tag: e.tag, text: e.target.text ?? "" }));
    const outlined = (await page.evaluate(
      `(function (list) {
        return list.map(function (p) {
          var el = document.body ? elementAtEditPath(p.path, document.body) : null;
          return { key: p.key, shown: !!el && shown(el), same: !!el && mentionSignatureMatches(el, p.tag, p.text || undefined) };
        });
      })(${JSON.stringify(probes)})`,
    )) as { key: string; shown: boolean; same: boolean }[];
    for (const o of outlined) {
      if (o.shown && !o.same) failures.push({ check: 2, key: o.key, reason: "outlines another element", knownClass: "script-created" });
    }
  } finally {
    await page.close();
  }

  // 3. the round trip to the server's lines
  for (const e of index) {
    const { selecciones } = await resolveMentions([refOf(e)], { pageHtml: () => doc.html, files: async () => ({}) });
    const sel = selecciones[0];
    if (!sel || !("desde" in sel) || sel.desde !== e.line || !sel.contenido.toLowerCase().startsWith(`<${e.tag}`)) {
      failures.push({ check: 3, key: e.key, reason: sel && "desde" in sel ? `anchored at line ${sel.desde}, entry says ${e.line}` : "no lines", knownClass: null });
    }
  }
  failures.push(...searchFailures(index));
  return { checked: index.length, failures };
}

const APP_PROBE = `
${decl("sourceChainOf", sourceChainOf)}
${decl("primaryOf", primaryOf)}
function shown(el) { var r = el.getBoundingClientRect(); var cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; }
`;

async function gateApp(browser: Browser, doc: GateDoc & { kind: "app" }): Promise<{ checked: number; failures: GateFailure[] }> {
  const index = await outlineApp(doc.files);
  const failures: GateFailure[] = [];
  const carpeta = { ...doc.files };
  const entry = entradaServida(doc.app.entrada, await bundleApp({ carpeta, app: doc.app, modo: "desarrollo" }), carpeta);
  const shell = injectDesignMode(doc.shell);
  const srv = createServer((req, res) => {
    const js = req.url === doc.app.entrada;
    res.writeHead(js || req.url === "/" ? 200 : 404, { "content-type": js ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" });
    res.end(js ? entry : req.url === "/" ? shell : "");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${addr.port}/#/`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => (document.getElementById("root")?.children.length ?? 0) > 0, { timeout: 30_000 });
    await page.addScriptTag({ content: APP_PROBE });
    const rendered = (await page.evaluate(`(function () {
      var out = [];
      var all = document.getElementById('root').getElementsByTagName('*');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (!shown(el)) continue;
        var svg = el.closest && el.closest('svg');
        if (svg && svg !== el) continue;
        out.push({ tag: el.tagName.toLowerCase(), chain: sourceChainOf(el, ${6}).map(function (c) { return { path: c.path, line: c.line }; }) });
      }
      return out;
    })()`)) as { tag: string; chain: { path: string; line: number }[] }[];
    const lines = new Set(index.map((e) => `${e.ruta}:${e.line}`));
    for (const r of rendered) {
      if (r.chain.some((c) => lines.has(`${c.path}:${c.line}`))) continue;
      failures.push({ check: 1, key: `<${r.tag}>`, reason: r.chain.length ? `chain ${r.chain.map((c) => `${c.path}:${c.line}`).join(" ")} has no entry` : "no source chain", knownClass: r.chain.length ? null : "library-created" });
    }
  } finally {
    await page.close();
    srv.close();
  }
  for (const e of index) {
    const { selecciones } = await resolveMentions([refOf(e)], { pageHtml: () => null, files: async () => doc.files });
    const sel = selecciones[0];
    if (!sel || !("desde" in sel) || sel.desde !== e.line) {
      failures.push({ check: 3, key: e.key, reason: sel && "desde" in sel ? `anchored at line ${sel.desde}` : "no lines", knownClass: null });
    }
  }
  failures.push(...searchFailures(index));
  return { checked: index.length, failures };
}

export async function runMentionsGate(docs: readonly GateDoc[]): Promise<GateReport> {
  const browser = await launch();
  try {
    const out: GateReport["docs"] = [];
    for (const d of docs) {
      const r = d.kind === "page" ? await gatePage(browser, d) : await gateApp(browser, d);
      out.push({ name: d.name, ...r });
    }
    return { docs: out };
  } finally {
    await browser.close();
  }
}
