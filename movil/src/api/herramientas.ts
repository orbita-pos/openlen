// The phone's calls for the person's tools (spec local 2026-11-04-herramientas-hechas-por-len, §4.14): the same list the
// web's rail and Herramientas page read (`GET /api/tools`), the frame of one on the phone's own private host
// (`POST /api/movil/tools/[id]/open`), and its icon — fetched with the key, because an <img> can't carry it.
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { InstalledToolView } from "@/lib/tools/types";

export interface HerramientasDeLaPersona {
  readonly tools: InstalledToolView[];
  readonly paid: boolean;
  readonly person: { readonly name: string };
}

/** The person's tools; `"off"` when the server has tools switched off (`OPENLEN_TOOLS=0`). Throws on any other failure. */
export async function listarHerramientas(c: ClienteDeOpenLen, idioma: string): Promise<HerramientasDeLaPersona | "off"> {
  const res = await c.pedir(`/api/tools?locale=${encodeURIComponent(idioma)}`);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status === 404 && body?.error === "tools_off") return "off";
  if (!res.ok || !body) throw new Error(String(res.status));
  const person = body.person && typeof body.person === "object" ? (body.person as { name?: unknown }) : {};
  return {
    tools: Array.isArray(body.tools) ? (body.tools as InstalledToolView[]) : [],
    paid: body.paid === true,
    person: { name: typeof person.name === "string" ? person.name : "" },
  };
}

/** Whether a tool can open at all: switched on, and neither removed, on the Free plan nor broken. */
export const sePuedeAbrir = (t: InstalledToolView): boolean => t.enabled && t.status === "ok";

export async function abrirHerramienta(c: ClienteDeOpenLen, id: string): Promise<{ url: string; origin: string } | { error: string }> {
  const res = await c.pedir(`/api/movil/tools/${encodeURIComponent(id)}/open`, { method: "POST" }).catch(() => null);
  if (!res) return { error: "network" };
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok && typeof body?.url === "string" && typeof body.origin === "string") return { url: body.url, origin: body.origin };
  return { error: typeof body?.error === "string" ? body.error : String(res.status) };
}

export async function iconoDeHerramienta(c: ClienteDeOpenLen, t: InstalledToolView): Promise<string | null> {
  const res = await c.pedir(t.iconUrl).catch(() => null);
  if (!res?.ok) return null;
  return URL.createObjectURL(await res.blob());
}
