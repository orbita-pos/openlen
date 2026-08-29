// Spike for "convert my AI page into this template" (Opción 1: design-identical
// + autofill content). Validates the DETERMINISTIC half with zero Gemini spend,
// and arms the single live fill behind --live for when the prepaid key has balance.
//
// What runs free (no Gemini), all on the REAL Rust html-ops engine:
//   1. Load a template's real HTML (--file=<path> offline, or --id=<slug> via DB/R2).
//   2. Fillability report: how many leaf text slots vs structural containers.
//   3. STRUCTURE-PRESERVATION PROOF — the "does the grid survive?" question.
//      Craft leaf-replace ops (what autofill emits) and run the REAL applyOps,
//      then fingerprint the tag+class skeleton of the template WITHOUT fills vs
//      WITH fills (both serialized by the same Rust pass, so it's apples-to-apples).
//      Identical skeleton ⇒ the design (grid, cards, layout) is untouched.
//
// What needs balance (the one Gemini call): --live runs the production
// fillTemplate() (gemini-2.5-flash) so we can eyeball real content mapping.
//
// Usage:
//   npx tsx scripts/spike-template-restyle.ts --file=templates/starter/mirror.html
//   npx tsx scripts/spike-template-restyle.ts --id=mirror
//   npx tsx scripts/spike-template-restyle.ts --file=<path> --live [--from-json=<biz.json>]

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tagWithOpIds, applyOps, stripOpIds, type Op } from "@/lib/html-ops";

// Mirrors the FILL_SYSTEM_PROMPT allowlist: the only tags autofill may replace.
const LEAF = "h1|h2|h3|h4|h5|h6|p|span|li|a|button|label|blockquote|em|strong|time|small|dt|dd|td|th|figcaption|summary";
// Containers autofill is forbidden to touch — the design fidelity guarantee
// rests entirely on these never being targeted.
const CONTAINER = "div|section|header|footer|article|nav|aside|form|main|ul|ol|dl|table|tr|picture|figure";

// Fallback business data when --from-json isn't given (a taquería poured into
// whatever template you point it at — stresses structural mismatch).
const SAMPLE_DATA: Record<string, unknown> = {
  business_name: "Tacos de Juan",
  industry: "Taquería tradicional mexicana",
  tagline_es: "Auténticos tacos al pastor desde 1989",
  pitch: "Más de 30 años sirviendo los mejores tacos al pastor de Monterrey. Tradición familiar, ingredientes frescos, salsa hecha en casa.",
  hero_keyword: "tradición",
  features: [
    { title: "Al pastor sobre trompo", desc: "Carne marinada 24 horas, cocinada lento sobre el trompo. La receta de mi abuelo Juan desde 1989." },
    { title: "Salsa hecha en casa", desc: "Roja, verde, habanera y de mango. Hechas a mano cada mañana con chiles tostados en comal." },
    { title: "Tortillas recién hechas", desc: "Maíz nixtamalizado, masa fresca, cocidas al momento. Nunca de bolsa." },
  ],
  pricing: [
    { name: "Taco al pastor", price: "$25", period: "/pieza", features: ["Cebolla y cilantro", "Salsa a elegir"] },
    { name: "Orden de 5", price: "$110", period: "", features: ["Mezcla a tu gusto", "Incluye refresco"] },
  ],
  testimonials: [
    { name: "María González", role: "Vecina del centro", company: "Cliente desde 2003", quote: "Llevo 20 años viniendo cada viernes. El sabor no ha cambiado." },
  ],
  cta_primary: "Pide por WhatsApp",
  cta_secondary: "Ver el menú",
  faq_questions: [{ q: "¿Hacen entregas a domicilio?", a: "Sí, en zona centro de Monterrey, pedido mínimo $150." }],
};

const arg = (flag: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
};
const has = (flag: string) => process.argv.includes(flag);

async function loadTemplate(): Promise<{ html: string; label: string }> {
  const file = arg("--file");
  const id = arg("--id");
  if (file) {
    if (!existsSync(file)) throw new Error(`Template file not found: ${file}`);
    return { html: readFileSync(file, "utf-8"), label: file };
  }
  if (id) {
    const { getTemplateHtml } = await import("@/lib/templates/store");
    const html = await getTemplateHtml(id);
    if (!html) throw new Error(`Template '${id}' not found in DB/storage`);
    return { html, label: `db:${id}` };
  }
  throw new Error("Pass --file=<path> or --id=<slug>");
}

// The design skeleton: tag + class for every opening tag, in document order.
// Comparing this before vs after a fill — both sides serialized by the same Rust
// pass — tells us whether anything structural moved (drift) or only text did.
function skeleton(html: string): string[] {
  const re = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const cls = /\bclass\s*=\s*"([^"]*)"/.exec(m[2])?.[1] ?? /\bclass\s*=\s*'([^']*)'/.exec(m[2])?.[1] ?? "";
    out.push(`${m[1].toUpperCase()}.${cls}`);
  }
  return out;
}

function tally(html: string): { leaves: number; containers: number; top: string } {
  const leafRe = new RegExp(`<(${LEAF})\\b[^>]*>([^<]*?)</\\1>`, "gi");
  const byTag: Record<string, number> = {};
  let leaves = 0, m: RegExpExecArray | null;
  while ((m = leafRe.exec(html))) {
    if (m[2].trim()) { leaves++; byTag[m[1].toLowerCase()] = (byTag[m[1].toLowerCase()] ?? 0) + 1; }
  }
  const contRe = new RegExp(`<(${CONTAINER})\\b`, "gi");
  let containers = 0;
  while (contRe.exec(html)) containers++;
  const top = Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t}:${n}`).join(" ");
  return { leaves, containers, top };
}

// Build leaf-replace ops just like autofill: first N true leaves (pure-text
// content), text swapped for a marker, attributes (class!) preserved, op-id dropped.
function craftLeafOps(taggedHtml: string, n: number) {
  const re = new RegExp(`<(${LEAF})\\b([^>]*)>([^<]*?)</\\1>`, "gi");
  const ops: Op[] = [];
  const picked: { tag: string; was: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(taggedHtml)) && ops.length < n) {
    const [, tag, attrs, text] = m;
    const was = text.trim();
    const id = /\bdata-op-id="([^"]+)"/.exec(attrs)?.[1];
    if (!was || !id) continue;
    const attrsClean = attrs.replace(/\s*data-op-id="[^"]*"/, "");
    ops.push({ type: "replace", target: id, newHtml: `<${tag}${attrsClean}>⟦FILLED⟧ ${was.split(/\s+/)[0]}</${tag}>` });
    picked.push({ tag: tag.toLowerCase(), was: was.slice(0, 48) });
  }
  return { ops, picked };
}

const fileUrl = (p: string) =>
  "file:///" + join(process.cwd(), p).replace(/\\/g, "/").replace(/^([A-Z]):/, (_, d: string) => d.toLowerCase() + ":");

function compareSkeleton(before: string, after: string, banner: string) {
  const a = skeleton(before), b = skeleton(after);
  const same = a.length === b.length && a.every((s, i) => s === b[i]);
  if (same) {
    console.log(`  ✅ ${banner} — tag+class skeleton identical (${a.length} elements; only leaf text moved)`);
  } else {
    const diffs = a.filter((s, i) => s !== b[i]).slice(0, 6);
    console.log(`  ⚠ ${banner} — skeleton drift (${a.length}→${b.length}): ${diffs.join(", ") || "(length only)"}`);
  }
  return same;
}

async function main() {
  const { html, label } = await loadTemplate();
  const outDir = join(".style-match-test", "template-restyle");
  mkdirSync(outDir, { recursive: true });
  const slug = label.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  console.log(`\n[spike] template: ${label}  (${(html.length / 1024).toFixed(1)} KB)`);

  // Rust-serialized baseline (op-ids stripped, no fills) — the fair "before".
  const { taggedHtml, taggedCount } = tagWithOpIds(html);
  const baseline = stripOpIds(taggedHtml);

  // 1. Fillability
  const { leaves, containers, top } = tally(baseline);
  console.log(`\n  Fillability:`);
  console.log(`    tagged elements:     ${taggedCount}`);
  console.log(`    fillable leaf slots: ${leaves}  (${top})`);
  console.log(`    structural blocks:   ${containers}  ← autofill never touches these`);

  // 2. Structure-preservation proof (deterministic — no Gemini)
  const N = Number(arg("--n") ?? 8);
  const { ops, picked } = craftLeafOps(taggedHtml, N);
  const apply = applyOps(taggedHtml, ops);
  const filled = apply.html ? stripOpIds(apply.html) : null;
  console.log(`\n  Structure proof: replaced ${apply.appliedCount}/${ops.length} leaf slots`);
  picked.forEach((p) => console.log(`    • ${p.tag} "${p.was}" → ⟦FILLED⟧…`));
  if (filled) {
    compareSkeleton(baseline, filled, "DESIGN INTACT");
    const proofPath = join(outDir, `${slug}.structure-proof.html`);
    writeFileSync(proofPath, filled);
    console.log(`     open:     ${fileUrl(proofPath)}`);
    console.log(`     original: ${fileUrl(label)}`);
  } else {
    console.log(`  ❌ applyOps produced no HTML: ${apply.errors[0]?.reason ?? "?"}`);
  }

  // 3. Live fill — the ONLY Gemini step
  if (!has("--live")) {
    const re = arg("--id") ? `id=${arg("--id")}` : `file=${arg("--file")}`;
    console.log(`\n  Live fill skipped (deterministic half only). When the key has balance:`);
    console.log(`    npx tsx scripts/spike-template-restyle.ts --${re} --live\n`);
    return;
  }
  // Aqui el spike podia pedir prestada una clave de Gemini de usar y tirar
  // (`SPIKE_GEMINI_API_KEY`) sin tocar la compartida. Los motores de relleno
  // corren en Fireworks desde el 2026-08-21 y no leen esa variable, asi que el
  // prestamo llevaba meses sin prestar nada.

  // Page→template mode (the REAL feature shape): pour --source page's content into
  // THIS template's design. --mode=1call (inventory, default) | 2call (extract+fill).
  const sourcePath = arg("--source");
  if (sourcePath) {
    if (!existsSync(sourcePath)) throw new Error(`Source page not found: ${sourcePath}`);
    const sourceHtml = readFileSync(sourcePath, "utf-8");
    const mode = arg("--mode") ?? "1call";
    console.log(`\n  Page→template [${mode}]: content from ${sourcePath} → design of ${label}…`);
    let out: string | null = null;
    let info = "";
    if (mode === "2call") {
      const { extractPageData, transplantHeadMeta } = await import("@/lib/style-match/autofill/fill-from-page");
      const { fillTemplate } = await import("@/lib/style-match/autofill/fill-template");
      const ex = await extractPageData(sourceHtml);
      if (!ex.ok) { console.log(`  ❌ extract (call 1/2) failed: ${ex.error}`); process.exitCode = 1; return; }
      console.log(`  ✓ extracted structured data (call 1/2)`);
      const r = await fillTemplate({ sourceHtml: transplantHeadMeta(html, sourceHtml), data: ex.data! });
      if (!r.ok) { console.log(`  ❌ fill (call 2/2) failed [${r.error.kind}]: ${r.error.message}`); process.exitCode = 1; return; }
      out = r.filledHtml; info = `2call · ${r.appliedOps}/${r.totalOps} ops · ${(r.durationMs / 1000).toFixed(1)}s`;
    } else {
      const { fillTemplateFromPage } = await import("@/lib/style-match/autofill/fill-from-page");
      const r = await fillTemplateFromPage({ templateHtml: html, sourcePageHtml: sourceHtml });
      if (!r.ok) {
        console.log(`  ❌ fill failed: ${r.error}`);
        if (r.raw) writeFileSync(join(outDir, `${slug}.page-fail.raw.txt`), r.raw);
        process.exitCode = 1; return;
      }
      out = r.html!;
      info = `1call · ${r.appliedOps}/${r.totalOps} ops · dropped ${r.droppedUnsafeOps} unsafe-ops · ${r.attempts} attempt(s) · ${(r.durationMs / 1000).toFixed(1)}s`;
    }
    const outPath = join(outDir, `${slug}.from-page.${mode}.html`);
    writeFileSync(outPath, out);
    console.log(`  ✓ ${info}`);
    compareSkeleton(baseline, out, "DESIGN vs TEMPLATE");
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(out)?.[1]?.trim();
    console.log(`  <title> now: "${title}"`);
    const heads = [...out.matchAll(/<(h1|h2|h3)[^>]*>([^<]+)<\/\1>/gi)].slice(0, 10).map((mm) => mm[2].trim());
    console.log(`  headings: ${heads.map((h) => `"${h}"`).join(" · ")}`);
    console.log(`  open: ${fileUrl(outPath)}`);
    return;
  }

  const fromJson = arg("--from-json");
  const data = fromJson ? JSON.parse(readFileSync(fromJson, "utf-8")) : SAMPLE_DATA;
  console.log(`\n  Live fill (gemini-2.5-flash) with ${fromJson ?? "built-in taquería sample"}…`);
  const { fillTemplate } = await import("@/lib/style-match/autofill/fill-template");
  // Retry once on a no-ops response — the model occasionally skips the <edits>
  // envelope; the real feature would need this fallback too.
  let res = await fillTemplate({ sourceHtml: html, data });
  for (let attempt = 2; !res.ok && (res.error.kind === "parse" || res.error.kind === "empty-ops") && attempt <= 2; attempt++) {
    console.log(`     retry ${attempt}/2 — model returned no ops…`);
    res = await fillTemplate({ sourceHtml: html, data });
  }
  if (!res.ok) {
    console.log(`  ❌ fill failed [${res.error.kind}]: ${res.error.message}`);
    if (res.error.kind === "missing-key")
      console.log(`     -> set FIREWORKS_API_KEY in .env.local.`);
    if (res.error.kind === "api" && /429|quota|rate/i.test(res.error.message))
      console.log(`     -> limite de tasa de Fireworks; reintenta en un minuto.`);
    if (res.rawResponse !== undefined) {
      const rawPath = join(outDir, `${slug}.fail.raw.txt`);
      writeFileSync(rawPath, res.rawResponse || "(empty response)");
      console.log(`     model returned ${res.rawResponse.length} chars (no <edits>). first 700:`);
      console.log("     ┃ " + (res.rawResponse.slice(0, 700).replace(/\n/g, "\n     ┃ ") || "(empty)"));
      console.log(`     full raw → ${fileUrl(rawPath)}`);
    }
    if (res.partialHtml) {
      const pPath = join(outDir, `${slug}.partial.html`);
      writeFileSync(pPath, res.partialHtml);
      console.log(`     partial filled → ${fileUrl(pPath)}`);
    }
    process.exitCode = 1; // avoid process.exit() — it trips a napi/libuv teardown assertion on Windows
    return;
  }
  const outPath = join(outDir, `${slug}.filled.html`);
  writeFileSync(outPath, res.filledHtml);
  console.log(`  ✓ filled ${res.appliedOps}/${res.totalOps} ops in ${(res.durationMs / 1000).toFixed(1)}s  (tokens ${res.usage?.inputTokens ?? "?"}/${res.usage?.outputTokens ?? "?"})`);
  compareSkeleton(baseline, res.filledHtml, "DESIGN AFTER REAL FILL");
  console.log(`    open:     ${fileUrl(outPath)}`);
  console.log(`    original: ${fileUrl(label)}\n`);
}

main().catch((err) => {
  console.error("\n[spike] unhandled:", err instanceof Error ? err.message : err);
  process.exit(1);
});
