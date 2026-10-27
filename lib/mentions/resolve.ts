// The «@» mentions of a message, anchored on the server against the files as
// they are NOW (spec local 2026-10-27, §6.9): the lines the browser saw are not
// trusted — Len may have edited the file since the pick. An element that moved
// is followed; one that cannot be found again goes as what is known about it,
// never with invented line numbers.
import "server-only";

import type { SeleccionDelDueno } from "@/lib/agent/context";
import type { MentionedFile } from "@/lib/agent/context";
import { seleccionDelLienzo } from "@/lib/agent/seleccion-del-lienzo";

import { outlineFile } from "./app-outline";
import { MAX_MENTIONS, type AppTarget, type MentionRef, type PageTarget } from "./types";

const LABEL_MAX = 200;
const PATH_MAX = 2000;
const TEXT_MAX = 40;

const str = (x: unknown): x is string => typeof x === "string";

function parseTarget(raw: unknown): PageTarget | AppTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const text = str(t.text) && t.text ? { text: t.text.slice(0, TEXT_MAX) } : {};
  if (t.type === "page" && str(t.path) && str(t.tag) && (t.page === null || str(t.page))) {
    return { type: "page", page: t.page as string | null, path: t.path.slice(0, PATH_MAX), tag: t.tag.slice(0, 40), ...text };
  }
  if (t.type === "app" && str(t.path) && t.path.startsWith("/") && str(t.tag) && Number.isInteger(t.line) && (t.line as number) > 0) {
    return { type: "app", path: t.path.slice(0, PATH_MAX), line: t.line as number, tag: t.tag.slice(0, 80), ...text };
  }
  return null;
}

export function parseMentions(raw: unknown): MentionRef[] {
  if (!Array.isArray(raw)) return [];
  const out: MentionRef[] = [];
  for (const item of raw) {
    if (out.length >= MAX_MENTIONS) break;
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    if (!str(m.label) || !m.label) continue;
    const label = m.label.slice(0, LABEL_MAX);
    if (m.type === "file" && str(m.ruta) && m.ruta.startsWith("/")) {
      out.push({ type: "file", label, ruta: m.ruta.slice(0, PATH_MAX) });
    } else if (m.type === "element") {
      const target = parseTarget(m.target);
      if (target) out.push({ type: "element", label, text: str(m.text) ? m.text.slice(0, TEXT_MAX) : "", target });
    }
  }
  return out;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The words a person reads in an HTML fragment: tags out, entities decoded. */
function wordsOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the element's own text is in the fragment's text (its own text
 *  can be split by inline children: «Pan <em>de</em> verdad»). */
function textFitsFragment(text: string, fragment: string): boolean {
  const words = wordsOf(fragment);
  // Punctuation alone («,» between spans) identifies nothing: only real words count.
  return text
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .every((w) => words.includes(w));
}

function pageSelection(ref: MentionRef & { type: "element" }, target: PageTarget, html: string | null): SeleccionDelDueno {
  const pista = { ruta: target.page ? `/${target.page}/index.html` : "/index.html", pista: ref.label };
  if (html === null) return pista;
  const sel = seleccionDelLienzo({ html, page: target.page, path: target.path, hint: ref.label });
  if (!sel || !("desde" in sel)) return sel ?? pista;
  // The path still resolves, but is it still THAT element? A page's structure can
  // change under a path; lines of a neighbour would point Len at the wrong thing.
  const sameTag = new RegExp(`^<${target.tag}[\\s>/]`, "i").test(sel.contenido);
  if (!sameTag || (target.text && !textFitsFragment(target.text, sel.contenido))) return { ruta: sel.ruta, pista: ref.label };
  return sel;
}

async function appSelection(ref: MentionRef & { type: "element" }, target: AppTarget, source: string | undefined): Promise<SeleccionDelDueno> {
  const pista = { ruta: target.path, pista: ref.label };
  if (source === undefined) return pista;
  const entries = await outlineFile(target.path, source);
  const sameTag = (tag: string) => tag.toLowerCase() === target.tag.toLowerCase();
  const textFits = (text: string) => !target.text || !text || text.startsWith(target.text);
  const onLine = entries.filter((e) => e.line === target.line);
  let found = onLine.find((e) => sameTag(e.tag) && textFits(e.text)) ?? (onLine.length === 1 && textFits(onLine[0]!.text) ? onLine[0] : undefined);
  if (!found) {
    found = entries
      .filter((e) => sameTag(e.tag) && (target.text ? e.text.startsWith(target.text) : true))
      .sort((a, b) => Math.abs(a.line - target.line) - Math.abs(b.line - target.line))[0];
  }
  if (!found) return pista;
  const hasta = found.endLine ?? found.line;
  const contenido = source.replace(/\r\n/g, "\n").split("\n").slice(found.line - 1, hasta).join("\n");
  return { ruta: target.path, desde: found.line, hasta, contenido };
}

export async function resolveMentions(
  refs: readonly MentionRef[],
  ctx: {
    /** The saved HTML of a page of the site (null = the home); null if it does not exist. */
    pageHtml: (page: string | null) => string | null;
    /** The project's files, as Len's terminal sees them; loaded only when needed. */
    files: () => Promise<Readonly<Record<string, string>>>;
  },
): Promise<{ selecciones: SeleccionDelDueno[]; ficheros: MentionedFile[] }> {
  const selecciones: SeleccionDelDueno[] = [];
  const ficheros: MentionedFile[] = [];
  let files: Readonly<Record<string, string>> | null = null;
  const loadFiles = async () => (files ??= await ctx.files());
  for (const ref of refs) {
    if (ref.type === "file") {
      const contenido = (await loadFiles())[ref.ruta];
      if (contenido !== undefined) ficheros.push({ ruta: ref.ruta, contenido });
    } else if (ref.target.type === "page") {
      selecciones.push(pageSelection(ref, ref.target, ctx.pageHtml(ref.target.page)));
    } else {
      selecciones.push(await appSelection(ref, ref.target, (await loadFiles())[ref.target.path]));
    }
  }
  return { selecciones, ficheros };
}
