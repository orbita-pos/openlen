// LOS DOCUMENTOS DEL LIENZO, EN MEMORIA.
//
// Es el `Map` que sirve la acción `preview` de Claude Code (su `Lb`): el
// documento se guarda por un id aleatorio y el iframe navega a él. Y es la
// misma forma que `lib/ai/origen-de-medida.ts` ya usa para el medidor.
//
// POR QUÉ EN MEMORIA: el lienzo enseña `activeDoc` + `pendientes`, lo que el
// usuario tiene en pantalla y la base todavía no. Servir lo guardado mentiría.
//
// ⚠️ UN SOLO PROCESO. Producción corre `node server.js` (infra/app/
// openlen-app.service). El día que haya varios, un POST y su GET pueden caer en
// procesos distintos y esto deja de valer.
//
// En `globalThis` y no en una variable de módulo: el POST y el GET son dos
// rutas, y el empaquetador puede darles instancias de módulo distintas.

import { randomBytes } from "node:crypto";

export const CADUCIDAD_MS = 30 * 60 * 1000;
export const TOPE_POR_USUARIO = 20;

export interface DocumentoGuardado {
  readonly html: string;
  readonly projectId: string;
  readonly userId: string;
  readonly pagina: string | null;
  readonly creado: number;
  ultimoUso: number;
}

const CLAVE = Symbol.for("openlen.lienzo.almacen");
type ConAlmacen = typeof globalThis & { [CLAVE]?: Map<string, DocumentoGuardado> };

function mapa(): Map<string, DocumentoGuardado> {
  const g = globalThis as ConAlmacen;
  return (g[CLAVE] ??= new Map());
}

function podar(ahora: number): void {
  const m = mapa();
  for (const [id, d] of m) if (ahora - d.ultimoUso > CADUCIDAD_MS) m.delete(id);
}

export function guardarDocumento(
  input: { html: string; projectId: string; userId: string; pagina: string | null },
  ahora = Date.now(),
): string {
  podar(ahora);
  const suyos = [...mapa()]
    .filter(([, d]) => d.userId === input.userId)
    .sort((a, b) => a[1].ultimoUso - b[1].ultimoUso);
  while (suyos.length >= TOPE_POR_USUARIO) mapa().delete(suyos.shift()![0]);
  const docId = randomBytes(32).toString("base64url");
  mapa().set(docId, { ...input, creado: ahora, ultimoUso: ahora });
  return docId;
}

/** El documento, o null si no existe o caducó. Leer renueva la caducidad. */
export function leerDocumento(docId: string, ahora = Date.now()): DocumentoGuardado | null {
  const d = mapa().get(docId);
  if (!d) return null;
  if (ahora - d.ultimoUso > CADUCIDAD_MS) {
    mapa().delete(docId);
    return null;
  }
  // MONÓTONO a propósito. El orden del tope es «se cae el de uso más antiguo»,
  // así que un reloj que retroceda —cambio de hora, ajuste por NTP— podría
  // REJUVENECER la marca de un documento recién leído y hacer que se cayera
  // antes que otro sin tocar. No es grave (peor efecto: un orden LRU
  // subóptimo), pero el `max` lo cierra sin costar nada.
  d.ultimoUso = Math.max(d.ultimoUso, ahora);
  return d;
}

/** SÓLO PRUEBAS. */
export function vaciarAlmacenParaPruebas(): void {
  mapa().clear();
}
