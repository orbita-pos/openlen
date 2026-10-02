/**
 * COMENTAR UNA LÍNEA DEL CÓDIGO Y MANDARLA CON EL MENSAJE (la #8 de
 * plans/len-agente-2026/notas/fase-5-taller.md).
 *
 * Como Claude Code: en el escritorio y en la web se pulsa una línea del diff, se
 * escribe un comentario, se juntan varios y van con el siguiente mensaje; en la
 * terminal, `ask` adjunta el diff de un fichero a tu siguiente mensaje y el botón
 * dice «preguntado» hasta que lo mandas. Aquí se comenta desde «Código» y desde
 * «Cambios»; los comentarios esperan en el compositor del chat, como fichas, y
 * van DENTRO de tu mensaje: son cosas que dijiste, así que se ven en tu burbuja,
 * siguen ahí al recargar y Len los tiene en los turnos siguientes. Con el
 * fichero, la línea y el código de esa línea, para que no tenga que adivinar.
 *
 * La cola vive en un objeto de módulo, como `abrirEnElCodigo`: las lentes del
 * lienzo empujan y el Chat la lee. Dura lo que la pestaña.
 *
 * Puro (salvo la cola): lo prueba vitest.
 */

/** Lo que escribes en la caja sigue con su tope de siempre. */
export const MAX_TEXTO_ESCRITO = 2000;
/** Cuántos comentarios van en un mensaje, como mucho. */
export const MAX_COMENTARIOS = 10;
/** Lo que se cita de la línea, y lo que se acepta de cada comentario. */
export const MAX_CODIGO_CITADO = 160;
export const MAX_COMENTARIO = 500;
/** El mensaje entero, con los comentarios: lo que aceptan /api/agent y ai-design. */
export const MAX_PROMPT = 10_000;

export interface ComentarioDeLinea {
  readonly id: number;
  /** La ruta absoluta del fichero (`/contacto/index.html`). */
  readonly ruta: string;
  readonly linea: number;
  /** La línea es del fichero de ANTES del turno (una quitada, en «Cambios»). */
  readonly deAntes?: boolean;
  /** El texto de esa línea, tal cual se veía. */
  readonly codigo: string;
  readonly texto: string;
}

export type NuevoComentario = Omit<ComentarioDeLinea, "id">;

export interface EtiquetasDeLosComentarios {
  /** «Comentarios en el código». */
  readonly titulo: string;
  /** «antes del turno», para una línea quitada. */
  readonly deAntes: string;
}

function citado(codigo: string): string {
  const linea = codigo.trim();
  const corto = linea.length > MAX_CODIGO_CITADO ? `${linea.slice(0, MAX_CODIGO_CITADO)}…` : linea;
  if (!corto) return "";
  // Las comillas de código que no choquen con las que ya lleve la línea.
  const valla = corto.includes("`") ? "``" : "`";
  return `${valla}${valla === "``" ? " " : ""}${corto}${valla === "``" ? " " : ""}${valla}`;
}

/**
 * Tu mensaje con los comentarios detrás, uno por línea:
 *
 *   cambia el color del botón
 *
 *   Comentarios en el código:
 *   - `contacto/index.html:16` `<address>Calle Marea 12</address>` — pon la nueva dirección
 */
export function textoConComentarios(
  texto: string,
  comentarios: readonly ComentarioDeLinea[],
  e: EtiquetasDeLosComentarios,
): string {
  const usados = comentarios.slice(0, MAX_COMENTARIOS).filter((c) => c.texto.trim());
  if (usados.length === 0) return texto;
  const filas = usados.map((c) => {
    const donde = `\`${c.ruta.replace(/^\/+/, "")}:${c.linea}\`${c.deAntes ? ` (${e.deAntes})` : ""}`;
    const codigo = citado(c.codigo);
    return `- ${donde}${codigo ? ` ${codigo}` : ""} — ${c.texto.trim().slice(0, MAX_COMENTARIO)}`;
  });
  return [texto.trim(), `${e.titulo}:\n${filas.join("\n")}`].filter(Boolean).join("\n\n");
}

export interface ComentariosDelChat {
  subscribe(fn: () => void): () => void;
  /** Los del proyecto; la MISMA referencia mientras no cambien (para `useSyncExternalStore`). */
  lista(projectId: string): readonly ComentarioDeLinea[];
  /** Null si ya hay `MAX_COMENTARIOS` esperando. */
  anadir(projectId: string, c: NuevoComentario): ComentarioDeLinea | null;
  quitar(projectId: string, id: number): void;
  vaciar(projectId: string): void;
}

const VACIA: readonly ComentarioDeLinea[] = [];

export function createComentariosDelChat(): ComentariosDelChat {
  const porProyecto = new Map<string, readonly ComentarioDeLinea[]>();
  const listeners = new Set<() => void>();
  let n = 0;
  const poner = (projectId: string, lista: readonly ComentarioDeLinea[]) => {
    if (lista.length === 0) porProyecto.delete(projectId);
    else porProyecto.set(projectId, lista);
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        // Un suscriptor que revienta no se lleva a los demás.
      }
    }
  };
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    lista(projectId) {
      return porProyecto.get(projectId) ?? VACIA;
    },
    anadir(projectId, c) {
      const antes = porProyecto.get(projectId) ?? VACIA;
      if (antes.length >= MAX_COMENTARIOS || !c.texto.trim()) return null;
      const nuevo: ComentarioDeLinea = { ...c, id: ++n, texto: c.texto.trim().slice(0, MAX_COMENTARIO) };
      poner(projectId, [...antes, nuevo]);
      return nuevo;
    },
    quitar(projectId, id) {
      const antes = porProyecto.get(projectId) ?? VACIA;
      if (antes.some((c) => c.id === id)) poner(projectId, antes.filter((c) => c.id !== id));
    },
    vaciar(projectId) {
      if (porProyecto.has(projectId)) poner(projectId, VACIA);
    },
  };
}

/** La instancia que comparten las lentes y el Chat. */
export const comentariosDelChat = createComentariosDelChat();
