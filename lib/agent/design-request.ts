// EL CAMPO `design` DE UN TURNO (modo Diseño de las apps): se valida con la
// postura de `scope` —topes, nada que tumbe el turno—. Un elemento inválido se
// descarta y los demás siguen.
import { z } from "zod";
import { DESIGN_LIMITS, DESIGN_PROPERTIES, type DesignRequest } from "@/lib/apps/design/types";

const CAMPOS = [...DESIGN_PROPERTIES, "text", "alt"] as const;
const Link = z.object({ path: z.string().regex(/^\/[^\0\s]{1,300}$/), line: z.number().int().min(1).max(100_000), component: z.string().max(100).nullable() });
const Change = z.object({ property: z.enum(CAMPOS), before: z.string().max(500), after: z.string().max(2000) });
const Photo = z.object({
  url: z.string().max(2000).refine((u) => /^https?:\/\//.test(u) || u.startsWith("/"), "url"),
  alt: z.string().max(300).optional(),
});
const Element = z.object({
  chain: z.array(Link).max(DESIGN_LIMITS.chain),
  primary: z.number().int().min(-1),
  tag: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
  text: z.string().max(DESIGN_LIMITS.text),
  copies: z.number().int().min(1).max(10_000),
  screen: z.string().regex(/^#\/[^\s]{0,200}$/),
  changes: z.array(Change).max(40),
  photo: Photo.optional(),
  note: z.string().max(DESIGN_LIMITS.note).optional(),
});

export function parseDesignRequest(raw: unknown, files: Readonly<Record<string, string>>): DesignRequest | null {
  if (!raw || typeof raw !== "object") return null;
  let tam = 0;
  try { tam = JSON.stringify(raw).length; } catch { return null; }
  if (tam > DESIGN_LIMITS.bytes) return null;
  const r = raw as { elements?: unknown; note?: unknown };
  const elements = (Array.isArray(r.elements) ? r.elements : [])
    .slice(0, DESIGN_LIMITS.elements * 2)
    .map((e) => Element.safeParse(e))
    .filter((p) => p.success)
    .map((p) => p.data!)
    .filter((e) => e.primary < e.chain.length && (e.chain.length > 0 || e.primary === -1))
    .filter((e) => e.chain.every((l) => {
      const c = files[l.path];
      return c !== undefined && l.line <= c.split("\n").length;
    }))
    .filter((e) => e.changes.length > 0 || !!e.photo || !!e.note?.trim())
    .slice(0, DESIGN_LIMITS.elements);
  const note = typeof r.note === "string" ? r.note.trim().slice(0, DESIGN_LIMITS.note) : "";
  if (elements.length === 0 && !note) return null;
  return { elements, ...(note ? { note } : {}) };
}
