// LOS DOCUMENTOS DEL LIENZO, EN MEMORIA.
//
// Es la forma de la acción `preview` de Claude Code: el documento se guarda en
// memoria por un id aleatorio y el iframe navega a él. Y es la
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

/**
 * EL TECHO GLOBAL, EN BYTES. Es lo único que acota este `Map` entre usuarios.
 *
 * LA ARITMÉTICA, medida el 2026-09-16 con documentos distintos (V8 comparte los
 * iguales y falsea la sonda), leyendo RSS y no `heapUsed`:
 *
 *   20 × 30 KB (la mediana real de 231 plantillas)   +1 MB por usuario
 *   20 × 90 KB (la mayor del corpus)                 +3 MB
 *   20 × 8 MB  (lo que `MAX_HTML_BYTES` permite)   +184 MB
 *
 * Contra `MemoryMax=3400M` (infra/app/openlen-app.service), un tope DURO de
 * cgroup compartido con Next y con los Chromium del medidor y de los ojos.
 * Dieciocho sesiones al tope se lo comen entero y el kernel mata la unidad.
 * `TOPE_POR_USUARIO` no lo impedía: acota a UN usuario, no la suma.
 *
 * 🔴 Y NO SE VE VENIR. Con 20 × 8 MB vivos `heapUsed` se queda en 4 MB y el RSS
 * sube 184: las cadenas grandes no viven donde mira la estadística de montón.
 * Una vigilancia basada en heap no vería llegar esto; lo ven el RSS y el
 * cgroup, y lo que hace el cgroup es matar.
 *
 * 256 MB es el 7,5% del presupuesto. Caben 256 usuarios a tamaño real antes de
 * desalojar a nadie, así que el caso normal no lo toca JAMÁS: esto es una red
 * para el caso adversario, no una política de producto.
 */
export const TOPE_GLOBAL_BYTES = 256 * 1024 * 1024;

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

/** Lo que ocupa un documento. `length` y no `Buffer.byteLength`: lo que se
 *  paga es la cadena EN MEMORIA —dos bytes por carácter en el peor caso— y no
 *  su serialización UTF-8, que es menor en el texto latino y engañaría por
 *  abajo justo en la página cargada de `data:` que motiva este techo. */
function bytesDe(d: DocumentoGuardado): number {
  return d.html.length * 2;
}

/**
 * EL TECHO GLOBAL: se desaloja por USO MÁS ANTIGUO hasta caber, sin mirar de
 * quién es.
 *
 * Que no mire de quién es no es un descuido, es la decisión: un techo por
 * usuario ya existe (`TOPE_POR_USUARIO`) y no acota la suma, que es justo el
 * caso que esto cubre. El que empuja tiene los documentos más recientes, así
 * que el LRU se come primero los suyos viejos — y un usuario normal, con 1 MB,
 * no llega nunca a esta función.
 */
function caber(): void {
  const m = mapa();
  let total = 0;
  for (const d of m.values()) total += bytesDe(d);
  if (total <= TOPE_GLOBAL_BYTES) return;
  const porUso = [...m].sort((a, b) => a[1].ultimoUso - b[1].ultimoUso);
  for (const [id, d] of porUso) {
    if (total <= TOPE_GLOBAL_BYTES) break;
    m.delete(id);
    total -= bytesDe(d);
  }
  // SE DICE. Un desalojo silencioso es indistinguible de un documento que
  // nunca se guardó, y el usuario lo vive como «el lienzo se quedó en blanco».
  // eslint-disable-next-line no-console
  console.warn(
    `[lienzo] techo global de ${Math.round(TOPE_GLOBAL_BYTES / 1024 / 1024)} MB alcanzado: ` +
      `se desalojaron los documentos de uso más antiguo (quedan ${m.size})`,
  );
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
  // DESPUÉS de meter el nuevo, no antes: el que acaba de llegar es el de uso
  // MÁS RECIENTE, así que es el último al que le tocaría caerse. Hacerlo antes
  // dejaría pasar un documento que por sí solo no cabe.
  caber();
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
