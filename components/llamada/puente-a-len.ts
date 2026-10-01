// El puente entre la voz (GPT-Live) y Len. La voz delega; aquí se abre un turno
// normal de Len con lo que dijo la persona, se le van pasando a la voz avances
// que no se oyen (`thinking`) y, al terminar, el resultado para que lo diga con
// sus palabras (`commentary`). Len no sabe que es una llamada: es su turno de
// siempre, y queda en el historial del chat.
import type { RespuestaPreparada } from "@/lib/agent/resultados";
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
  | { tipo: "publicar"; confirm: { action: "publicar"; subdominio: string; idiomas: string[]; republicar: boolean } };

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

const AVANCES: Record<string, string> = {
  ver_visitas: "Len está mirando las visitas de la página.",
  ver_mensajes: "Len está leyendo los mensajes del chat.",
  ver_formularios: "Len está mirando los formularios que llegaron.",
  preparar_respuesta: "Len está preparando el borrador de la respuesta.",
  Read: "Len está leyendo la página.",
  Grep: "Len está leyendo la página.",
  Glob: "Len está leyendo la página.",
  Edit: "Len está cambiando la página.",
  Write: "Len está cambiando la página.",
  mirar_pagina: "Len está comprobando cómo quedó la página.",
  usar_pagina: "Len está comprobando cómo quedó la página.",
  verificar_diseno: "Len está comprobando cómo quedó la página.",
  publicar: "Len está preparando la publicación.",
};

export function fraseDeAvance(herramienta: string): string | null {
  return AVANCES[herramienta] ?? null;
}

export function crearPuenteALen(deps: DepsDelPuente) {
  let oido = "";
  let turnoId: string | null = null;
  let enCurso = false;

  const voz = (type: EventoParaLaVoz["type"], delegation_id: string, content: string) =>
    deps.enviarALaVoz({ type, delegation_id, content });

  async function delegar(delegationId: string): Promise<void> {
    const pedido = oido.trim();
    oido = "";

    if (enCurso) {
      // Con Len trabajando, lo nuevo corrige el encargo en vez de abrir otro.
      if (turnoId && pedido) {
        await deps.dirigir(turnoId, pedido).catch(() => {});
        voz("session.thinking.append", delegationId, `La persona corrigió el encargo mientras Len trabaja: «${pedido}». Len ya lo tiene; espera su resultado.`);
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
        else if (e.nombre === "action" && typeof d.tool === "string") {
          usadas.add(d.tool);
          const f = fraseDeAvance(d.tool);
          if (f && !avisadas.has(f)) {
            avisadas.add(f);
            voz("session.thinking.append", delegationId, f);
          }
        } else if (e.nombre === "confirm" && d.action === "responder") {
          confirmaciones.push({ tipo: "respuesta", respuesta: d as unknown as RespuestaPreparada });
        } else if (e.nombre === "confirm" && d.action === "publicar" && typeof d.subdominio === "string") {
          confirmaciones.push({
            tipo: "publicar",
            confirm: {
              action: "publicar",
              subdominio: d.subdominio,
              idiomas: Array.isArray(d.idiomas) ? d.idiomas.filter((x): x is string => typeof x === "string") : [],
              republicar: d.republicar === true,
            },
          });
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
    if (usadas.has("ver_visitas")) deps.mostrarTarjeta({ tipo: "visitas" });
    if (usadas.has("ver_mensajes") || usadas.has("ver_formularios")) deps.mostrarTarjeta({ tipo: "texto", texto });
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
    trabajando: () => enCurso,
  };
}
