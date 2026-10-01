// Lo que la pantalla principal lee de OpenLen, por el cliente de la app.
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { StoredChatTurn } from "@/lib/projects/types";

export class SinRed extends Error {}

export interface ProyectoEnLista { id: string; title: string; subdomain: string | null; publishedAt: string | null; updatedAt: string }
export interface ProyectoAbierto { id: string; title: string; subdomain: string | null; publicado: boolean; historial: StoredChatTurn[] }

async function json<T>(p: Promise<Response>): Promise<T> {
  let r: Response;
  try {
    r = await p;
  } catch {
    throw new SinRed();
  }
  if (!r.ok) throw new Error(`OpenLen respondió ${r.status}`);
  return (await r.json()) as T;
}

export async function listarProyectos(c: ClienteDeOpenLen): Promise<ProyectoEnLista[]> {
  const j = await json<{ projects: ProyectoEnLista[] }>(c.pedir("/api/projects"));
  return [...j.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function leerProyecto(c: ClienteDeOpenLen, id: string): Promise<ProyectoAbierto> {
  const j = await json<{ project: { id: string; title: string; subdomain: string | null; publishedAt: string | null; chatHistory: StoredChatTurn[] } }>(
    c.pedir(`/api/projects/${encodeURIComponent(id)}`),
  );
  const p = j.project;
  return { id: p.id, title: p.title, subdomain: p.subdomain, publicado: p.publishedAt !== null, historial: p.chatHistory };
}

export async function enlaceDeVistaPrevia(c: ClienteDeOpenLen, base: string, id: string): Promise<string> {
  const j = await json<{ enabled: boolean; token: string }>(
    c.pedir(`/api/projects/${encodeURIComponent(id)}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
  );
  return `${base}/p/${encodeURIComponent(id)}?t=${encodeURIComponent(j.token)}`;
}

export async function leerTurno(c: ClienteDeOpenLen, fila: string): Promise<{ turno: StoredChatTurn; turnoId?: string }> {
  return json(c.pedir(`/api/agent/turno/${encodeURIComponent(fila)}`));
}
