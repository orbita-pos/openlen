import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { StoredChatTurn } from "@/lib/projects/types";
import type { DatosDeVisitas } from "@/lib/voz/tarjeta-de-visitas";
import type { LenWatchSettings, LenWatchStatus } from "@/lib/len-watch/types";
import type { Idioma } from "../config";

export class ErrorGestion extends Error {
  constructor(readonly status: number, readonly codigo: string, readonly datos: Record<string, unknown> = {}) {
    super(typeof datos.message === "string" ? datos.message : codigo);
  }
}
export interface ProyectoGestion {
  id: string; title: string; subdomain: string | null; url: string | null;
  hasUnpublishedChanges: boolean; goal: StoredChatTurn["goal"] | null; rol: string;
}
export function urlPublicada(p: { publishedAt: unknown; deployUrl?: string | null }): string | null {
  if (!p.publishedAt || !p.deployUrl) return null;
  try {
    const url = new URL(p.deployUrl);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
async function pedir<T>(c: ClienteDeOpenLen, ruta: string, init?: RequestInit): Promise<T> {
  const r = await c.pedir(ruta, init);
  const data = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) throw new ErrorGestion(r.status, typeof data.error === "string" ? data.error : `HTTP ${r.status}`, data);
  return data as T;
}
const post = (body: object): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
export async function cargarGestion(c: ClienteDeOpenLen, id: string, signal?: AbortSignal): Promise<ProyectoGestion> {
  const { project: p } = await pedir<{ project: { id: string; title: string; subdomain: string | null; publishedAt: string | null; deployUrl: string | null; hasUnpublishedChanges?: boolean; chatHistory?: StoredChatTurn[]; rol?: string } }>(c, `/api/projects/${encodeURIComponent(id)}`, { signal });
  return { id: p.id, title: p.title, subdomain: p.subdomain, url: urlPublicada(p), hasUnpublishedChanges: !!p.hasUnpublishedChanges,
    goal: [...(p.chatHistory ?? [])].reverse().find(t => t.goal)?.goal ?? null, rol: p.rol ?? "dueno" };
}
export function comprobarNombre(c: ClienteDeOpenLen, subdomain: string, signal?: AbortSignal) {
  return pedir<{ available: boolean; reason?: string }>(c, "/api/subdomains/check", { ...post({ subdomain }), signal });
}
export interface ConfirmacionPublicar { acceptSecurityFingerprint?: string; confirmFingerprint?: string; skipMissingSecrets?: boolean; acceptLenWatchFix?: string }
export function publicar(c: ClienteDeOpenLen, id: string, subdomain: string, locale: Idioma, confirmacion: ConfirmacionPublicar = {}) {
  return pedir<{ url: string; publishedAt: string }>(c, `/api/projects/${encodeURIComponent(id)}/publish`, post({ subdomain, locale, ...confirmacion }));
}
// LEN WATCH (spec local 2026-10-30-len-watch): its state, the owner's switches, «Fix with Len» and Approve.
const rutaLenWatch = (id: string, sub = "") => `/api/projects/${encodeURIComponent(id)}/len-watch${sub}`;
export function lenWatchEstado(c: ClienteDeOpenLen, id: string, signal?: AbortSignal) {
  return pedir<LenWatchStatus>(c, rutaLenWatch(id), { signal });
}
export function lenWatchAjustes(c: ClienteDeOpenLen, id: string, cambio: Partial<LenWatchSettings>) {
  return pedir<{ settings: LenWatchSettings }>(c, rutaLenWatch(id), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cambio) });
}
export function lenWatchArreglar(c: ClienteDeOpenLen, id: string) {
  return pedir<{ status: "fixing" }>(c, rutaLenWatch(id, "/fix"), post({}));
}
export function lenWatchAprobar(c: ClienteDeOpenLen, id: string, confirmarCambios = false) {
  return pedir<Record<string, unknown>>(c, rutaLenWatch(id, "/approve"), post(confirmarCambios ? { confirmChanged: true } : {}));
}
/** «Traer el arreglo» (spec §5.5): the fix Len published comes into the draft. */
export function lenWatchTraer(c: ClienteDeOpenLen, id: string, incidentId: string) {
  return pedir<{ status: "brought" | "nothing" | "handed_to_len" | "queued" }>(c, rutaLenWatch(id, "/bring"), post({ incidentId }));
}
export function leerVisitas(c: ClienteDeOpenLen, id: string, zona: string, signal?: AbortSignal) {
  return pedir<DatosDeVisitas>(c, `/api/voz/visitas?project=${encodeURIComponent(id)}&zona=${encodeURIComponent(zona)}`, { signal });
}
export function quitarEncargo(c: ClienteDeOpenLen, projectId: string) {
  return pedir<{ ok: true }>(c, "/api/agent/encargo", post({ projectId, action: "clear" }));
}
export function pausarEncargo(c: ClienteDeOpenLen, turnoId: string) {
  return pedir<{ ok: true }>(c, "/api/agent/cancelar", post({ turnoId }));
}
