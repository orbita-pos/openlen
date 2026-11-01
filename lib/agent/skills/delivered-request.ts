/**
 * Reading one delivered file for a request (spec local 2026-10-26-len-skills, §4.9; the phone since
 * 2026-10-31-len-movil, §5.1): the person by the web session or the phone's key, access to SEE the
 * project, a name that can only be one `present` stored, and its bytes from the private store. Shared
 * by the download route and the route that opens an HTML on the canvas host.
 */
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";

import { deliveryStore } from "./deliveries";

const TURN = /^[A-Za-z0-9_-]{1,100}$/;
const FILE = /^[0-9a-f]{8}-[\p{L}\p{N}._-]{1,100}$/u;

function decoded(segment: string): string | null {
  if (!segment.includes("%")) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export interface DeliveredRead {
  readonly userId: string;
  /** The file's own name, without the id prefix. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

export async function readDeliveredFile(req: Request, params: { readonly id: string; readonly turn: string; readonly file: string }): Promise<DeliveredRead | Response> {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const access = await exigirAcceso(params.id, userId, "ver");
  if (access instanceof Response) return access;

  const turn = decoded(params.turn);
  const file = decoded(params.file);
  if (!turn || !file || !TURN.test(turn) || !FILE.test(file)) return Response.json({ error: "not_found" }, { status: 404 });
  const store = deliveryStore();
  if (!store) return Response.json({ error: "unavailable" }, { status: 503 });
  const bytes = await store.get(`deliveries/${params.id}/${turn}/${file}`);
  if (!bytes) return Response.json({ error: "not_found" }, { status: 404 });
  return { userId, name: file.slice(9), bytes };
}
