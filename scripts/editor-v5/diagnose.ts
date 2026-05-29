// Editor V5 hardening — Phase 2 diagnostic.
//
// Renders every corpus body with the REAL inline-edit runtime, then for every
// [data-openlen-editable] element: captures the original text's glyph rects,
// drives the genuine startEdit() via a synthetic click, captures the overlay's
// glyph rects, and records the signed deltas + a CSS fingerprint.
//
// METRIC — we compare where the GLYPHS land (Range.getClientRects()), original
// vs overlay, in the same render. This is font/box-model independent and is the
// literal product requirement: "the letters land in the same place". >2px on
// any axis (or a fragment-count mismatch) is a failure.
//
//   npx tsx --tsconfig tsconfig.eval.json scripts/editor-v5/diagnose.ts [limitBodies]
//
// Writes tests/visual/corpus-patterns.json (cluster census) and
// tests/visual/corpus-diagnostic.json (failures + per-category counts).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

import {
  CORPUS_DIR,
  loadTailwindCss,
  prepareDoc,
  readBody,
  readManifest,
} from "./corpus-lib";

const THRESH = 2; // px

interface Measure {
  idx: number;
  tag: string;
  editMode: "element" | "run";
  childCount: number;
  origLen: number;
  ovLen: number;
  dx: number;
  dy: number;
  dw: number;
  maxFragDx: number;
  maxFragDy: number;
  overlayMissing: boolean;
  spurious: boolean;
  cbDecision: "fixed" | "absolute";
  fp: {
    textAlign: string;
    textWrap: string;
    lineHeight: string;
    fontSize: string;
    centered: boolean;
    balance: boolean;
    vwFont: boolean;
    ancTransform: boolean;
    anc3d: boolean;
    ancAnim: boolean;
    ancestorCBs: string;
    multiLine: boolean;
  };
}

// Runs INSIDE the page. Self-contained (Playwright serializes it). Returns one
// Measure per editable element (or skips hidden/empty ones).
function measureAll(thresh: number): Measure[] {
  interface Row { top: number; left: number; right: number; width: number }
  // Glyph rects → line rows. getClientRects() emits a rect per inline fragment;
  // collapsed whitespace and box-internal splits produce spurious fragments. We
  // cluster by vertical band so the metric measures LINES (what the eye sees),
  // immune to trailing-space / zero-width fragment noise.
  function rowsOf(range: Range): Row[] {
    const list = range.getClientRects();
    const rects: DOMRect[] = [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.width > 0.5 && r.height > 0.5) rects.push(r);
    }
    rects.sort((a, b) => a.top - b.top || a.left - b.left);
    const rows: Row[] = [];
    for (const r of rects) {
      const band = Math.max(4, r.height / 2);
      const row = rows.find((x) => Math.abs(x.top - r.top) <= band);
      if (row) {
        row.left = Math.min(row.left, r.left);
        row.right = Math.max(row.right, r.right);
        row.top = Math.min(row.top, r.top);
        row.width = row.right - row.left;
      } else {
        rows.push({ top: r.top, left: r.left, right: r.right, width: r.width });
      }
    }
    rows.sort((a, b) => a.top - b.top);
    return rows;
  }
  function firstNonBlank(root: Node): Text | null {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n = w.nextNode();
    while (n) {
      if ((n as Text).data && /[^\s ​﻿]/.test((n as Text).data))
        return n as Text;
      n = w.nextNode();
    }
    return null;
  }
  function establishesCB(cs: CSSStyleDeclaration): boolean {
    if (cs.transform && cs.transform !== "none") return true;
    if (cs.filter && cs.filter !== "none") return true;
    if ((cs as unknown as { perspective: string }).perspective && (cs as unknown as { perspective: string }).perspective !== "none") return true;
    if (cs.willChange && /transform|perspective|filter/.test(cs.willChange)) return true;
    if (cs.contain && /paint|layout|strict|content/.test(cs.contain)) return true;
    return false;
  }

  const out: Measure[] = [];
  const els = Array.from(
    document.querySelectorAll("[data-openlen-editable]"),
  ) as HTMLElement[];
  const bodyCB = establishesCB(getComputedStyle(document.body));
  const htmlCB = establishesCB(getComputedStyle(document.documentElement));
  const cbDecision: "fixed" | "absolute" = bodyCB || htmlCB ? "absolute" : "fixed";

  for (let idx = 0; idx < els.length; idx++) {
    const el = els[idx];
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const editMode: "element" | "run" =
        el.children.length === 0 ? "element" : "run";

      // Resolve the text the runtime will edit + the ground-truth glyph rects.
      let styleSource: HTMLElement = el;
      const range = document.createRange();
      if (editMode === "element") {
        range.selectNodeContents(el);
      } else {
        const tn = firstNonBlank(el);
        if (!tn) continue;
        range.selectNodeContents(tn);
        styleSource = (tn.parentElement as HTMLElement) || el;
      }
      const origRows = rowsOf(range);
      if (origRows.length === 0) continue; // hidden / empty
      const o0 = origRows[0];
      const rawRects = range.getClientRects();
      const clickX = o0.left + Math.min(4, o0.width / 2);
      const clickY = rawRects.length ? rawRects[0].top + rawRects[0].height / 2 : o0.top + 8;

      const cs = getComputedStyle(styleSource);
      // ancestor transform fingerprint
      let ancTransform = false;
      let anc3d = false; // 3D transform (matrix3d) — not reproducible by a 2D overlay
      let ancAnim = false; // animating ancestor (marquee/scroll/float) — moving target
      const ancCBs: string[] = [];
      let anc: HTMLElement | null = el.parentElement;
      while (anc && anc !== document.documentElement) {
        const acs = getComputedStyle(anc);
        if (establishesCB(acs)) {
          ancTransform = true;
          ancCBs.push(anc.tagName.toLowerCase());
        }
        if (acs.transform && acs.transform.indexOf("matrix3d") !== -1) anc3d = true;
        if (acs.animationName && acs.animationName !== "none") ancAnim = true;
        anc = anc.parentElement;
      }
      const classAttr = (el.getAttribute("class") || "") + (el.getAttribute("style") || "");
      const fp = {
        textAlign: cs.textAlign,
        textWrap: (cs as unknown as { textWrap: string }).textWrap || "",
        lineHeight: cs.lineHeight,
        fontSize: cs.fontSize,
        centered: cs.textAlign === "center",
        balance:
          /balance/.test((cs as unknown as { textWrap: string }).textWrap || "") ||
          /text-balance/.test(classAttr),
        vwFont: /clamp\(|vw|text-\[/.test(classAttr),
        ancTransform,
        anc3d,
        ancAnim,
        ancestorCBs: Array.from(new Set(ancCBs)).join(","),
        multiLine: origRows.length > 1,
      };

      // Drive the real startEdit via a synthetic click.
      el.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: clickX,
          clientY: clickY,
          view: window,
        }),
      );

      const overlay = document.querySelector(
        "[data-openlen-edit-overlay]",
      ) as HTMLElement | null;

      let dx = 0,
        dy = 0,
        dw = 0,
        maxFragDx = 0,
        maxFragDy = 0,
        ovLen = 0,
        overlayMissing = false;
      const fsPx = parseFloat(fp.fontSize) || 16;
      let spurious = false; // a SUBSTANTIAL overlay line with no original counterpart
      if (!overlay || !overlay.firstChild) {
        overlayMissing = true;
      } else {
        const ovRange = document.createRange();
        ovRange.selectNodeContents(overlay);
        const ovRows = rowsOf(ovRange);
        ovLen = ovRows.length;
        if (ovRows.length > 0) {
          dx = ovRows[0].left - o0.left;
          dy = ovRows[0].top - o0.top;
          dw = ovRows[0].width - o0.width;
          // Match each ORIGINAL line to the nearest overlay line; the error is
          // the worst left/top gap across original lines (every visible line of
          // the page text must be reproduced in place).
          const near = (rows: typeof ovRows, top: number) =>
            rows.reduce((a, b) => (Math.abs(b.top - top) < Math.abs(a.top - top) ? b : a));
          for (const orow of origRows) {
            const m = near(ovRows, orow.top);
            maxFragDx = Math.max(maxFragDx, Math.abs(m.left - orow.left));
            maxFragDy = Math.max(maxFragDy, Math.abs(m.top - orow.top));
          }
          // A SUBSTANTIAL overlay row (wider than ~one space) with no original
          // row within a line is a real extra line of text (wrap divergence);
          // a narrow extra row is just a hung trailing space → invisible.
          const band = Math.max(4, fsPx / 2);
          for (const vrow of ovRows) {
            if (vrow.width <= fsPx * 0.75) continue;
            const nearest = origRows.reduce(
              (best, o) => Math.min(best, Math.abs(o.top - vrow.top)),
              Infinity,
            );
            if (nearest > band) spurious = true;
          }
        } else {
          overlayMissing = true;
        }
      }

      // Tear down (Escape → finishEdit(false), no mutation since no typing).
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );

      const r2 = (n: number) => Math.round(n * 100) / 100;
      out.push({
        idx,
        tag: el.tagName.toLowerCase(),
        editMode,
        childCount: el.children.length,
        origLen: origRows.length,
        ovLen,
        dx: r2(dx),
        dy: r2(dy),
        dw: r2(dw),
        maxFragDx: r2(maxFragDx),
        maxFragDy: r2(maxFragDy),
        overlayMissing,
        spurious,
        cbDecision,
        fp,
      });
    } catch {
      // Best-effort: skip an element that throws, keep the batch alive.
      try {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      } catch {
        /* ignore */
      }
    }
  }
  void thresh;
  return out;
}

type Category =
  | "pass"
  | "overlay-missing"
  | "A-position"
  | "B-size"
  | "C-wrap"
  | "D-multiline";

function classify(m: Measure): Category {
  // Metric = "do the glyphs land in the same place": first-row anchor (dx/dy),
  // per-row anchor deltas, and line count. Box WIDTH (dw) is deliberately NOT a
  // failure criterion: CSS Text-3 hangs trailing white-space in pre-wrap (the
  // overlay's forced mode), so a hung space inflates the measured row width by
  // ~one space WITHOUT moving any glyph (dx stays 0). Flagging dw would report
  // visually-perfect overlays as broken. Real wrap divergence still trips the
  // row-count (D) and per-row (C) checks.
  if (m.overlayMissing) return "overlay-missing";
  if (Math.abs(m.dx) > THRESH || Math.abs(m.dy) > THRESH) return "A-position";
  if (m.spurious) return "D-multiline"; // a real extra/missing line of visible text
  if (m.maxFragDx > THRESH || m.maxFragDy > THRESH) return "C-wrap"; // a line shifted
  return "pass";
}

async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
  const tailwind = loadTailwindCss();
  const { entries } = readManifest();
  const bodies = entries.slice(0, limit);

  const browser: Browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // tsx/esbuild compiles with --keep-names, which wraps named functions in
  // __name() — both in this file's page.evaluate fns AND in the runtime's
  // .toString()-injected core. Provide an identity shim so they resolve.
  await ctx.addInitScript(
    "window.__name = window.__name || function (f) { return f; };",
  );
  // Block external egress (CDNs/fonts unreachable in sandbox) so renders are
  // deterministic and fast; everything needed is inlined by prepareDoc.
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("about:"))
      return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", () => {}); // ignore inline-config script errors

  interface Row extends Measure {
    bodyId: string;
    kind: string;
    group: string;
    category: Category;
  }
  const rows: Row[] = [];
  let bodiesWithEditables = 0;

  for (let i = 0; i < bodies.length; i++) {
    const e = bodies[i];
    try {
      const doc = prepareDoc(readBody(e), tailwind);
      await page.setContent(doc, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.evaluate(() =>
        document.body.setAttribute("data-openlen-edit-mode", ""),
      );
      // wait for marking (or conclude there are none)
      await page
        .waitForFunction(
          () => document.querySelectorAll("[data-openlen-editable]").length > 0,
          { timeout: 3000 },
        )
        .catch(() => {});
      const measures = await page.evaluate(measureAll, THRESH);
      if (measures.length) bodiesWithEditables++;
      for (const m of measures) {
        rows.push({
          ...m,
          bodyId: e.id,
          kind: e.kind,
          group: e.group,
          category: classify(m),
        });
      }
      if ((i + 1) % 25 === 0)
        console.log(`  ${i + 1}/${bodies.length} bodies, ${rows.length} elements measured`);
    } catch (err) {
      console.warn(`  ✗ ${e.kind}/${e.id}: ${String(err).slice(0, 120)}`);
    }
  }
  await browser.close();

  // ---- Per-element passmap (regression floor) ----
  // Stable key = kind/bodyId#idx (querySelectorAll order is stable for a fixed
  // body). regression-check.ts diffs this against a saved baseline so a Phase-6
  // subsystem can never silently break a previously-passing element.
  const passmap: Record<string, string> = {};
  for (const r of rows) passmap[`${r.kind}/${r.bodyId}#${r.idx}`] = r.category;
  writeFileSync(
    join(CORPUS_DIR, "corpus-passmap.json"),
    JSON.stringify(passmap),
    "utf8",
  );

  // ---- Diagnostic summary ----
  const byCat: Record<string, number> = {};
  for (const r of rows) byCat[r.category] = (byCat[r.category] || 0) + 1;
  const failures = rows.filter((r) => r.category !== "pass");
  // Split failures into ARCHITECTURAL (editable inside a 3D-transformed or
  // actively-animating ancestor — not reproducible by a body-level 2D overlay)
  // vs GENUINE 2D layout failures the editor should handle.
  const archFailures = failures.filter((r) => r.fp.anc3d || r.fp.ancAnim);
  const genuineFailures = failures.filter((r) => !r.fp.anc3d && !r.fp.ancAnim);

  // ---- Pattern cluster census (Phase 1.4) ----
  const sig = (r: Row) =>
    [
      r.editMode,
      r.fp.centered ? "center" : "left",
      r.fp.balance ? "balance" : "nobalance",
      r.fp.vwFont ? "vw" : "px",
      r.fp.ancTransform ? "ancTransform" : "noAncT",
      r.cbDecision,
      r.fp.multiLine ? "multiline" : "single",
    ].join("|");
  const clusters: Record<
    string,
    { count: number; failed: number; cats: Record<string, number>; example: { bodyId: string; tag: string } }
  > = {};
  for (const r of rows) {
    const s = sig(r);
    if (!clusters[s])
      clusters[s] = { count: 0, failed: 0, cats: {}, example: { bodyId: r.bodyId, tag: r.tag } };
    clusters[s].count++;
    if (r.category !== "pass") {
      clusters[s].failed++;
      clusters[s].cats[r.category] = (clusters[s].cats[r.category] || 0) + 1;
    }
  }
  const clusterList = Object.entries(clusters)
    .map(([signature, v]) => ({ signature, ...v }))
    .sort((a, b) => b.count - a.count);

  writeFileSync(
    join(CORPUS_DIR, "..", "corpus-patterns.json"),
    JSON.stringify(
      {
        totalBodies: bodies.length,
        bodiesWithEditables,
        totalElements: rows.length,
        signatureLegend:
          "editMode|align|balance|fontUnit|ancestorCB|cbDecision|lineCount",
        clusters: clusterList,
      },
      null,
      2,
    ),
    "utf8",
  );

  const r2 = (n: number) => Math.round(n * 100) / 100;
  writeFileSync(
    join(CORPUS_DIR, "..", "corpus-diagnostic.json"),
    JSON.stringify(
      {
        thresholdPx: THRESH,
        totalElements: rows.length,
        byCategory: byCat,
        failureRate: r2((failures.length / Math.max(1, rows.length)) * 100),
        architecturalFailures: archFailures.length,
        genuineFailures: genuineFailures.length,
        genuine2dPassRate: r2(((rows.length - genuineFailures.length) / Math.max(1, rows.length)) * 100),
        genuineFailureList: genuineFailures
          .map((r) => ({ id: `${r.kind}/${r.bodyId}#${r.idx}`, tag: r.tag, editMode: r.editMode, cat: r.category, dx: r.dx, dy: r.dy, fragDx: r.maxFragDx, align: r.fp.textAlign }))
          .slice(0, 120),
        worstOffsets: rows
          .map((r) => ({ id: `${r.kind}/${r.bodyId}#${r.idx}`, tag: r.tag, editMode: r.editMode, dx: r.dx, dy: r.dy, dw: r.dw, maxFragDx: r.maxFragDx, maxFragDy: r.maxFragDy, category: r.category }))
          .sort((a, b) => Math.max(Math.abs(b.dx), Math.abs(b.dy), b.maxFragDx) - Math.max(Math.abs(a.dx), Math.abs(a.dy), a.maxFragDx))
          .slice(0, 60),
        failures: failures.slice(0, 500),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log("\n=== DIAGNOSTIC SUMMARY ===");
  console.log(`bodies: ${bodies.length} (with editables: ${bodiesWithEditables})`);
  console.log(`elements measured: ${rows.length}`);
  console.log("by category:", byCat);
  console.log(`failure rate: ${r2((failures.length / Math.max(1, rows.length)) * 100)}% (${failures.length})`);
  console.log(
    `  architectural (3D/animated ancestor): ${archFailures.length}  |  genuine 2D: ${genuineFailures.length}` +
      `  → genuine-2D pass rate: ${r2(((rows.length - genuineFailures.length) / Math.max(1, rows.length)) * 100)}%`,
  );
  console.log(`top clusters by volume:`);
  for (const c of clusterList.slice(0, 12))
    console.log(`  [${c.count} | ${c.failed} fail] ${c.signature}  e.g. ${c.example.bodyId}/${c.example.tag}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
