// El puente entre la voz (GPT-Live) y Len. La voz delega; aquí se abre un turno
// normal de Len con lo que dijo la persona, se le van pasando a la voz avances
// que no se oyen (`thinking`) y, al terminar, el resultado para que lo diga con
// sus palabras (`commentary`). Len no sabe que es una llamada: es su turno de
// siempre, y queda en el historial del chat.
import type { RespuestaPreparada } from "@/lib/agent/resultados";
import { dataChangesForCard, type DataChangesPreview } from "@/lib/backend/data-changes-types";
import { currentToolName } from "@/lib/agent/tool-renames";
import type { EventoSse } from "@/lib/len-bench/sse";

export type EventoParaLaVoz = {
  type: "session.thinking.append" | "session.commentary.append";
  delegation_id: string | null;
  content: string;
};

export type TarjetaDeLlamada =
  | { tipo: "visitas" }
  | { tipo: "texto"; texto: string }
  | { tipo: "respuesta"; respuesta: RespuestaPreparada }
  | { tipo: "publicar"; confirm: { action: "publish"; subdominio: string; idiomas: string[]; republicar: boolean; cambiosDeDatos?: DataChangesPreview } };

export interface DepsDelPuente {
  pedirALen(prompt: string, alEvento: (e: EventoSse) => void): Promise<void>;
  dirigir(turnoId: string, texto: string): Promise<void>;
  enviarALaVoz(e: EventoParaLaVoz): void;
  mostrarTarjeta(t: TarjetaDeLlamada): void;
  alCambiarEstado?(trabajando: boolean): void;
}

/** GPT-Live acepta hasta 500 tokens por `append`; ~3,6 caracteres por token. */
export const MAX_CARACTERES_PARA_LA_VOZ = 1800;

/** La llamada cobra aunque nadie hable: si Len tarda más que esto, la voz
 *  ofrece colgar (el turno sigue en el servidor y llega el aviso). */
export const AVISO_DE_ESPERA_MS = 180_000;

export function recortarParaLaVoz(texto: string, max = MAX_CARACTERES_PARA_LA_VOZ): string {
  const limpio = texto
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#]/g, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max);
  const punto = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("? "), corte.lastIndexOf("! "));
  return `${punto > 0 ? corte.slice(0, punto + 1) : corte} …`;
}

// Con los nombres de hoy (las 11 pasaron al inglés el 2026-10-06); lo que llegue
// con uno de antes se traduce en `fraseDeAvance`.
const AVANCES: Record<string, string> = {
  get_visits: "Len está mirando las visitas de la página.",
  list_messages: "Len está leyendo los mensajes del chat.",
  list_form_submissions: "Len está mirando los formularios que llegaron.",
  draft_reply: "Len está preparando el borrador de la respuesta.",
  Read: "Len está leyendo la página.",
  Grep: "Len está leyendo la página.",
  Glob: "Len está leyendo la página.",
  Edit: "Len está cambiando la página.",
  Write: "Len está cambiando la página.",
  view_page: "Len está comprobando cómo quedó la página.",
  use_page: "Len está comprobando cómo quedó la página.",
  verificar_diseno: "Len está comprobando cómo quedó la página.",
  publish: "Len está preparando la publicación.",
};

export function fraseDeAvance(herramienta: string): string | null {
  return AVANCES[currentToolName(herramienta)] ?? null;
}

/** La tarjeta que pide un `confirm` del turno: el borrador o «Publicar». La
 *  usan la llamada y el chat de la app: una sola lectura del evento. */
export function tarjetaDeConfirmacion(d: Record<string, unknown>): TarjetaDeLlamada | null {
  if (d.action === "responder") return { tipo: "respuesta", respuesta: d as unknown as RespuestaPreparada };
  if (d.action === "publish" && typeof d.subdominio === "string") {
    const cambiosDeDatos = dataChangesForCard(d.cambiosDeDatos);
    return {
      tipo: "publicar",
      confirm: {
        action: "publish",
        subdominio: d.subdominio,
        idiomas: Array.isArray(d.idiomas) ? d.idiomas.filter((x): x is string => typeof x === "string") : [],
        republicar: d.republicar === true,
        ...(cambiosDeDatos ? { cambiosDeDatos } : {}),
      },
    };
  }
  return null;
}

/** Lo que Len ya está haciendo FUERA de la llamada (lo pediste por el chat). */
export interface EncargoDeFuera {
  /** El turno en curso, para corregirlo; null mientras aún no se sabe. */
  turnoId: string | null;
  /** Lo que la persona pidió, tal cual. */
  pedido: string;
}

/** Para la voz, al empezar (o en cuanto aparece): sin esto, si llamabas con Len
 *  trabajando, no sabía en qué (Jesús, 01/10). */
export function contextoDelEncargo(e: EncargoDeFuera): string {
  return `Ahora mismo Len está trabajando en algo que la persona le pidió por el chat: «${recortarParaLaVoz(e.pedido, 300)}». Si pregunta qué está haciendo Len, díselo con tus palabras. Lo que pida ahora sobre eso le llega a Len como corrección de ese mismo encargo: no hace falta abrir otro.`;
}

export function crearPuenteALen(deps: DepsDelPuente) {
  let oido = "";
  let turnoId: string | null = null;
  let enCurso = false;
  let deFuera: EncargoDeFuera | null = null;

  const voz = (type: EventoParaLaVoz["type"], delegation_id: string | null, content: string) =>
    deps.enviarALaVoz({ type, delegation_id, content });

  async function delegar(delegationId: string): Promise<void> {
    const pedido = oido.trim();
    oido = "";

    if (enCurso || deFuera) {
      // Con Len trabajando —en lo que pidió la llamada o en lo del chat—, lo
      // nuevo corrige ese encargo en vez de abrir otro sobre la misma página.
      const id = enCurso ? turnoId : (deFuera?.turnoId ?? null);
      if (id && pedido) {
        await deps.dirigir(id, pedido).catch(() => {});
        voz("session.thinking.append", delegationId, `La persona corrigió el encargo mientras Len trabaja: «${pedido}». Len ya lo tiene; espera su resultado.`);
      } else if (pedido) {
        voz("session.commentary.append", delegationId, "Len acaba de empezar y todavía no puede recibir correcciones: pide a la persona que lo repita en un momento.");
      }
      return;
    }
    if (!pedido) {
      voz("session.commentary.append", delegationId, "No entendí qué hay que pedirle a Len: pide en pocas palabras que lo repita.");
      return;
    }

    enCurso = true;
    deps.alCambiarEstado?.(true);
    const espera = setTimeout(
      () => voz("session.commentary.append", delegationId, "Len sigue trabajando y tardará un poco más. Ofrece colgar: Len avisará cuando termine."),
      AVISO_DE_ESPERA_MS,
    );
    let texto = "";
    let error: string | null = null;
    let cerrado = false;
    let empezo = false;
    const usadas = new Set<string>();
    const avisadas = new Set<string>();
    const confirmaciones: TarjetaDeLlamada[] = [];

    try {
      await deps.pedirALen(pedido, (e) => {
        const d = (e.datos ?? {}) as Record<string, unknown>;
        if (e.nombre === "turno" && typeof d.turnoId === "string") {
          turnoId = d.turnoId;
          empezo = true;
        } else if (e.nombre === "text" && typeof d.text === "string") texto += d.text;
        // El intento fallido no existió (`lib/agent/loop.ts`, reintentos): la voz no lo dice.
        else if (e.nombre === "retry" && typeof d.discardChars === "number") texto = texto.slice(0, Math.max(0, texto.length - d.discardChars));
        // Ni lo de un intento que desbordó y se repitió tras compactar.
        else if (e.nombre === "compaction" && typeof d.discardChars === "number") texto = texto.slice(0, Math.max(0, texto.length - d.discardChars));
        else if (e.nombre === "action" && typeof d.tool === "string") {
          usadas.add(currentToolName(d.tool));
          const f = fraseDeAvance(d.tool);
          if (f && !avisadas.has(f)) {
            avisadas.add(f);
            voz("session.thinking.append", delegationId, f);
          }
        } else if (e.nombre === "confirm") {
          const tarjeta = tarjetaDeConfirmacion(d);
          if (tarjeta) confirmaciones.push(tarjeta);
        } else if (e.nombre === "error") error = typeof d.message === "string" ? d.message : "error desconocido";
        else if (e.nombre === "done") cerrado = true;
      });
    } catch (e) {
      // Cortarse el stream con el turno ya empezado no es un fallo de Len: lo
      // resuelve `!cerrado` abajo. Sin id de turno, Len ni empezó (un 401, un
      // 400): eso sí es un fallo, y se dice con su motivo.
      if (!empezo && error === null) error = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(espera);
      enCurso = false;
      turnoId = null;
      deps.alCambiarEstado?.(false);
    }

    if (error !== null) {
      voz("session.commentary.append", delegationId, `Len no pudo terminar. El motivo, tal cual: ${recortarParaLaVoz(error, 400)}`);
      return;
    }
    if (!cerrado) {
      // El turno vive en el servidor (Len 2.1): cortarse el stream no lo para.
      voz("session.commentary.append", delegationId, "Se perdió la conexión con Len, pero Len sigue trabajando en el servidor y avisará cuando termine.");
      return;
    }
    if (usadas.has("get_visits")) deps.mostrarTarjeta({ tipo: "visitas" });
    if (usadas.has("list_messages") || usadas.has("list_form_submissions")) deps.mostrarTarjeta({ tipo: "texto", texto });
    for (const t of confirmaciones) deps.mostrarTarjeta(t);
    voz(
      "session.commentary.append",
      delegationId,
      `Resultado de Len (dilo corto y con tus palabras; números y nombres tal cual): ${recortarParaLaVoz(texto) || "Len terminó sin decir nada."}`,
    );
  }

  return {
    oir(delta: string) {
      oido += delta;
    },
    delegar,
    trabajando: () => enCurso || deFuera !== null,
    /** El encargo que Len hace fuera de la llamada; null cuando no hay. Se
     *  puede volver a llamar (p. ej. cuando llega el id del turno). */
    seguirEncargo(e: EncargoDeFuera | null) {
      deFuera = e;
    },
    /** Terminó el encargo de fuera: la voz lo cuenta, como contexto general. */
    terminoEncargo(texto: string) {
      if (!deFuera) return;
      deFuera = null;
      voz(
        "session.commentary.append",
        null,
        `Len terminó lo que la persona le pidió por el chat. Resultado (dilo corto y con tus palabras; números y nombres tal cual): ${recortarParaLaVoz(texto) || "Len terminó sin decir nada."}`,
      );
    },
  };
}
