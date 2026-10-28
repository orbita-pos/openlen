import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { AccionEquipo, DatosEquipo } from "./tipos";
export class ErrorEquipo extends Error {
  constructor(public codigo: string) { super(codigo); }
}
async function leer<T>(respuesta: Promise<Response>): Promise<T> {
  let r: Response;
  try { r = await respuesta; } catch { throw new ErrorEquipo("sin_red"); }
  const body = await r.json().catch(() => null) as { error?: string } | null;
  if (!r.ok) {
    if (r.status === 404 && !body?.error) throw new ErrorEquipo("no_disponible");
    if (r.status === 401 || r.status === 404) throw new ErrorEquipo("sin_acceso");
    throw new ErrorEquipo(body?.error ?? "error");
  }
  if (!body) throw new ErrorEquipo("error");
  return body as T;
}
export function cargarEquipo(c: ClienteDeOpenLen, projectId: string, signal?: AbortSignal) {
  return leer<DatosEquipo>(c.pedir(`/api/movil/equipo?project=${encodeURIComponent(projectId)}`, { signal }));
}
export function accionEquipo(c: ClienteDeOpenLen, projectId: string, accion: AccionEquipo) {
  return leer<{ id?: string; filaId?: string | null }>(c.pedir("/api/movil/equipo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, ...accion }) }));
}
