// LAS HUELLAS DE LAS VARIABLES DEL AJUSTE (spec local 2026-10-10).
//   · `envHashOf`: la de las de PRODUCCIÓN, que «cambios sin publicar» compara
//     con la de la última publicación. `null` sin ninguna: un proyecto sin
//     variables no tiene deriva nueva.
//   · `envVersionOf`: la de la lista ENTERA (los dos entornos), para que el PUT
//     sepa si alguien la cambió desde que el diálogo la leyó.
import { createHash } from "node:crypto";

import type { EnvTarget, StoredEnvVar } from "./rules";

export function envHashOf(vars: Readonly<Record<string, string>>): string | null {
  const names = Object.keys(vars).sort();
  if (names.length === 0) return null;
  const h = createHash("sha256");
  for (const n of names) h.update(n, "utf8").update("\u0000").update(vars[n]!, "utf8").update("\u0000");
  return h.digest("hex").slice(0, 16);
}

export function envVersionOf(vars: readonly StoredEnvVar[]): string {
  const key = (v: StoredEnvVar) => `${v.target}\u0000${v.name}`;
  const h = createHash("sha256");
  for (const v of [...vars].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))) {
    h.update(key(v), "utf8").update("\u0000").update(v.value, "utf8").update("\u0000");
  }
  return h.digest("hex").slice(0, 16);
}

/** Las de un entorno, como las lee `import.meta.env`. */
export function varsOfTarget(vars: readonly StoredEnvVar[], target: EnvTarget): Record<string, string> {
  return Object.fromEntries(vars.filter((v) => v.target === target).map((v) => [v.name, v.value]));
}
