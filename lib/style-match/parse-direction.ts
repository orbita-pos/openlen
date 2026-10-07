// LA DIRECCIÓN VISUAL QUE MANDA EL CLIENTE (la referencia por URL, «hazme una
// como ésta»). Mudada tal cual desde `app/api/generate/route.ts` el 2026-10-06
// (plans/crear-es-len): ahora también la lee `/api/agent`, porque crear es el
// primer mensaje a Len y la referencia viaja con él.
import type { StyleDirection } from "./direction-types";

/** La dirección visual que el cliente adjunta, validada campo a campo.
 *
 *  Nada de confiar en la forma: esto acaba dentro del prompt, y un objeto con
 *  un `character` de 50.000 caracteres o una paleta de mil entradas sería una
 *  forma barata de inflar cada generación. `directionToBriefBlock` recorta al
 *  final, pero recortar es la última red, no la primera. */
export function parseStyleDirection(body: unknown): StyleDirection | null {
  const raw = (body as { styleDirection?: unknown })?.styleDirection;
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const palette = Array.isArray(d.palette)
    ? d.palette
        .filter(
          (p): p is { role: string; hex: string } =>
            !!p && typeof p === "object" &&
            typeof (p as { hex?: unknown }).hex === "string" &&
            /^#[0-9a-f]{6}$/i.test((p as { hex: string }).hex) &&
            typeof (p as { role?: unknown }).role === "string",
        )
        .slice(0, 6)
        .map((p) => ({ role: p.role.slice(0, 24), hex: p.hex }))
    : [];
  if (palette.length === 0) return null;
  const radius = ["sharp", "soft", "rounded", "pill"].includes(String(d.radius))
    ? (d.radius as StyleDirection["radius"])
    : "soft";
  const character = typeof d.character === "string" && d.character.trim().length >= 10
    ? d.character.trim().slice(0, 320)
    : undefined;
  return {
    hostname: "",
    palette,
    polarity: d.polarity === "dark" ? "dark" : "light",
    fontFamily: typeof d.fontFamily === "string" ? d.fontFamily.slice(0, 60) : "sans-serif",
    radius,
    ...(character ? { character } : {}),
  };
}
