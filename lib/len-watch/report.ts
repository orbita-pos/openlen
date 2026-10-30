// What a published page's snippet (./snippet.ts) sends, read as the untrusted input it is: a
// stranger's browser wrote it. Everything is validated and SCRUBBED here, before anything stores it
// or Len reads it (spec local 2026-10-30-len-watch, §5.1 and §6).
import type { WatchReport } from "./types";

const MAX_MESSAGE = 300;
const MAX_FILE = 200;
const MAX_POSITION = 10_000_000;
// Same slug grammar as app/c/[projectId]/route.ts — strict match, no normalization.
const PAGE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const URL_TAIL = /(https?:\/\/[^\s?#]+)[?#]\S*/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN = /[A-Za-z0-9_-]{24,}/g;
const DIGIT_RUN = /\+?\d[\d .-]*\d/g;

/** Takes out what could be a visitor's data: a URL's query and hash, emails, long tokens, and
 *  runs of 7 digits or more (phones, cards, ids). */
export function scrubText(s: string): string {
  return s
    .replace(URL_TAIL, "$1")
    .replace(EMAIL, "[email]")
    .replace(TOKEN, "[token]")
    .replace(DIGIT_RUN, (run) => (run.replace(/\D/g, "").length >= 7 ? "[number]" : run));
}

function position(x: unknown): number | null {
  return typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= MAX_POSITION ? x : null;
}

function filePath(x: unknown): string | null {
  if (typeof x !== "string" || !x.trim()) return null;
  try {
    return new URL(x, "https://x.invalid").pathname.slice(0, MAX_FILE);
  } catch {
    return null;
  }
}

/** A `{ t:"f", m, f, l, c, p }` body → a clean report; anything else → null. */
export function parseWatchReport(body: unknown): WatchReport | null {
  if (!body || typeof body !== "object") return null;
  const d = body as { t?: unknown; m?: unknown; f?: unknown; l?: unknown; c?: unknown; p?: unknown };
  if (d.t !== "f") return null;
  const message = typeof d.m === "string" ? scrubText(d.m).trim().slice(0, MAX_MESSAGE) : "";
  return {
    message: message || null,
    file: filePath(d.f),
    line: position(d.l),
    col: position(d.c),
    page: typeof d.p === "string" && PAGE_SLUG_RE.test(d.p) ? d.p : null,
  };
}
