// La cabecera `Prefer`, como PostgREST (src/library/PostgREST/ApiRequest/Preferences.hs):
// varias separadas por comas o en varias cabeceras; si una se repite, gana la
// primera; `Preference-Applied` devuelve las que se aplicaron.
//
// `tx=commit|rollback` sólo vale con `db-tx-end` que permita cambiarlo; en
// Supabase no lo permite (es `commit`), así que aquí tampoco: se ignora.

export interface Preferences {
  readonly resolution?: "merge-duplicates" | "ignore-duplicates";
  readonly representation?: "representation" | "minimal" | "headers-only";
  readonly count?: "exact" | "planned" | "estimated";
  readonly missing?: "default" | "null";
  readonly handling?: "strict" | "lenient";
  readonly timezone?: string;
  readonly maxAffected?: number;
  readonly invalid: readonly string[];
}

const ACCEPTED = new Set([
  "resolution=merge-duplicates",
  "resolution=ignore-duplicates",
  "return=representation",
  "return=minimal",
  "return=headers-only",
  "count=exact",
  "count=planned",
  "count=estimated",
  "tx=commit",
  "tx=rollback",
  "missing=default",
  "missing=null",
  "handling=strict",
  "handling=lenient",
]);

export function parsePreferences(headers: Headers): Preferences {
  const raw = headers.get("prefer");
  const prefs = (raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const first = <T extends string>(prefix: string, values: readonly T[]): T | undefined => {
    for (const p of prefs) {
      if (!p.startsWith(prefix)) continue;
      const v = p.slice(prefix.length) as T;
      if (values.includes(v)) return v;
    }
    return undefined;
  };
  const stripped = (prefix: string) => prefs.find((p) => p.startsWith(prefix))?.slice(prefix.length);
  const maxAffectedRaw = stripped("max-affected=");
  const maxAffected = maxAffectedRaw !== undefined && /^\d+$/.test(maxAffectedRaw) ? Number(maxAffectedRaw) : undefined;
  const timezone = stripped("timezone=");
  const resolution = first("resolution=", ["merge-duplicates", "ignore-duplicates"] as const);
  const representation = first("return=", ["representation", "minimal", "headers-only"] as const);
  const count = first("count=", ["exact", "planned", "estimated"] as const);
  const missing = first("missing=", ["default", "null"] as const);
  const handling = first("handling=", ["strict", "lenient"] as const);
  return {
    ...(resolution ? { resolution } : {}),
    ...(representation ? { representation } : {}),
    ...(count ? { count } : {}),
    ...(missing ? { missing } : {}),
    ...(handling ? { handling } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
    ...(maxAffected !== undefined ? { maxAffected } : {}),
    invalid: prefs.filter((p) => !ACCEPTED.has(p) && !p.startsWith("timezone=") && !p.startsWith("max-affected=")),
  };
}

/** `shouldCount`: `exact` y `estimated` cuentan de verdad. */
export function shouldCount(p: Preferences): boolean {
  return p.count === "exact" || p.count === "estimated";
}

/** `prefAppliedHeader`, en su orden. */
export function preferenceApplied(p: Preferences): string | null {
  const vals = [
    p.resolution && `resolution=${p.resolution}`,
    p.missing && `missing=${p.missing}`,
    p.representation && `return=${p.representation}`,
    p.count && `count=${p.count}`,
    p.handling && `handling=${p.handling}`,
    p.timezone !== undefined && `timezone=${p.timezone}`,
    p.handling === "strict" && p.maxAffected !== undefined && `max-affected=${p.maxAffected}`,
  ].filter((v): v is string => typeof v === "string");
  return vals.length > 0 ? vals.join(", ") : null;
}
