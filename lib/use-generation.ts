"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { noCreditsRefill } from "@/lib/credits-client";

// ─────────────────────────────────────────────────────────────────────────────
// useGeneration — drives the /new AI entry flow.
//
// POSTs a brief to /api/generate and consumes the Server-Sent Events stream
// (reasoning_chunk / html_chunk / critic-checking / regen-starting /
// project_saved / error). The page renders the streaming reasoning, then a
// live preview of the streaming HTML; if the S3 vision critic triggers a
// regen the preview resets and the improved version streams in. Redirects to
// ?project=<id> when `project_saved` lands.
//
// A client-side watchdog aborts if the server goes fully silent (a wedged
// route, a dead connection, no SSE at all) — the server's own stall guard
// normally errors first, this is the catch-all so the UI never hangs forever.
// ─────────────────────────────────────────────────────────────────────────────

export type GenerationState =
  | { kind: "idle" }
  | {
      kind: "generating";
      reasoning: string;
      html: string;
      notice?: string;
      /** Lo que el NAVEGADOR midió sobre la página anterior, tal cual sale del
       *  servidor. Se enseña verbatim y sin traducir: es un dato, no prosa —
       *  «Assignment to constant variable» dice qué arreglar y «hubo un
       *  problema» no dice nada. Sólo existe durante una reescritura. */
      medido?: string;
    }
  | { kind: "done"; projectId: string; title: string }
  // `noCredits` is the one error the page renders as its own panel instead of
  // routing through classifyAiError — running out of credits is not a failed
  // generation, and "tweak your brief and retry" is wrong advice for it.
  | { kind: "error"; message: string; noCredits?: { refillsAt: string | null } };

import type { StyleDirection } from "@/lib/style-match/direction-types";

export interface UseGenerationResult {
  state: GenerationState;
  generate: (
    brief: string,
    styleDirection?: StyleDirection | null,
    /** `data:image/…;base64,…` — las fotos que el visitante adjunto en el
     *  heroe o en el compositor del taller. Hasta `MAX_REFERENCIAS`; el
     *  servidor recorta igualmente, esto es comodidad. */
    referenceImages?: readonly string[],
  ) => Promise<void>;
}

// No SSE byte for this long → assume the server is wedged and give up.
// The /api/generate route streams bytes throughout (html_chunk during the
// page write, or a progress ping every 5s during the model's initial think),
// so a healthy generation always keeps this reset. Generous enough that
// only a fully dead connection trips it.
const SILENCE_TIMEOUT_MS = 780_000;

export function useGeneration(): UseGenerationResult {
  const [state, setState] = useState<GenerationState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream on unmount so a generation the user walked away
  // from stops server-side (saves credits / metered usage).
  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = useCallback(async (brief: string, styleDirection: StyleDirection | null = null, referenceImages: readonly string[] = []) => {
    // Cancel any in-flight generation before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "generating", reasoning: "", html: "" });

    // Watchdog — reset on every byte from the server. Only fires on real
    // silence (no response at all, or the stream went dead).
    let timedOut = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, SILENCE_TIMEOUT_MS);
    };
    const clearWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = undefined;
    };

    armWatchdog();

    let response: Response;
    try {
      response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        // La referencia POR URL viaja como OBJETO, no como bloque ya montado:
        // el techo de 900 caracteres y la redaccion los garantiza el servidor.
        //
        // Y la FOTO adjunta viaja como imagen de verdad. Aqui decia que nunca
        // podia hacerlo —«una imagen desviaria el turno a Gemini y la pagina la
        // escribe DeepSeek»— y eso caduco el 2026-08-28: hoy la lleva QWEN, que
        // tiene ojos y va por el mismo transporte de Fireworks.
        body: JSON.stringify({
          brief,
          ...(styleDirection ? { styleDirection } : {}),
          // SE MANDA `referenceImages` (plural) Y TAMBIEN `referenceImage`
          // (singular) cuando hay exactamente una. El endpoint ya lee las dos
          // —el lector plural acepta un objeto suelto—, pero el singular sigue
          // saliendo por si una version vieja del servidor atiende la peticion
          // durante el despliegue: en esa ventana, un cliente nuevo contra un
          // servidor viejo perderia la foto sin decir nada.
          ...(referenceImages.length
            ? {
                referenceImages: referenceImages.map((dataBase64) => ({ dataBase64 })),
                referenceImage: { dataBase64: referenceImages[0] },
              }
            : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearWatchdog();
      if (controller.signal.aborted) {
        if (timedOut) {
          setState({
            kind: "error",
            message:
              "La generación no respondió a tiempo — probá de nuevo.",
          });
        }
        return;
      }
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (!response.ok || !response.body) {
      clearWatchdog();
      setState({ kind: "error", message: await errorMessage(response) });
      return;
    }

    // Los trozos se AGRUPAN por fotograma en vez de escribir estado por cada
    // uno. En localhost el stream no tiene latencia de red: los `html_chunk`
    // llegan más rápido de lo que el navegador pinta, y un `setState` por trozo
    // son cientos de renders por segundo del árbol entero de `/new` — que es lo
    // que dispara «Maximum update depth exceeded» al generar. En producción la
    // latencia entre trozos dejaba pintar y lo escondía.
    //
    // Visualmente no se pierde nada: el preview no puede pintar más de una vez
    // por fotograma de todas formas, y el iframe recibe el mismo texto, sólo
    // que en trozos más grandes. Lo pendiente se vacía SIEMPRE al terminar el
    // stream, así que el último trozo no se queda dentro.
    let pendienteHtml = "";
    let pendienteRazon = "";
    let fotograma: number | null = null;
    const programar = (fn: () => void): number =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(fn)
        : (setTimeout(fn, 16) as unknown as number);
    const cancelar = (h: number): void => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(h);
      else clearTimeout(h);
    };
    const sink: EventSink = {
      setState,
      chunk(kind, text) {
        if (kind === "html") pendienteHtml += text;
        else pendienteRazon += text;
        if (fotograma === null) {
          fotograma = programar(() => {
            fotograma = null;
            sink.flush();
          });
        }
      },
      flush() {
        if (fotograma !== null) {
          cancelar(fotograma);
          fotograma = null;
        }
        if (!pendienteHtml && !pendienteRazon) return;
        const h = pendienteHtml;
        const r = pendienteRazon;
        pendienteHtml = "";
        pendienteRazon = "";
        setState((prev) =>
          prev.kind === "generating"
            ? { ...prev, html: prev.html + h, reasoning: prev.reasoning + r }
            : prev,
        );
      },
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armWatchdog(); // bytes flowing — reset the silence clock
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          applyEvent(rawEvent, sink);
        }
      }
      sink.flush();
      clearWatchdog();
      // EOF SIN EVENTO TERMINAL. Una 200 que se cierra limpiamente sin
      // `project_saved` ni `error` dejaba el estado en `generating` PARA
      // SIEMPRE: el watchdog ya está apagado, así que no hay nada que vaya a
      // sacar de ahí al usuario — spinner eterno y sólo se sale recargando.
      // Si un evento terminal ya movió el estado, esto no toca nada.
      setState((prev) =>
        prev.kind === "generating"
          ? {
              kind: "error",
              message:
                "La conexión se cerró antes de terminar la página. Vuelve a intentarlo.",
            }
          : prev,
      );
    } catch (err) {
      sink.flush();
      clearWatchdog();
      if (controller.signal.aborted) {
        if (timedOut) {
          setState({
            kind: "error",
            message:
              "La generación se quedó sin respuesta — probá de nuevo.",
          });
        }
        return;
      }
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  return { state, generate };
}

async function errorMessage(response: Response): Promise<string> {
  if (response.status === 401) {
    return "You need to be signed in to generate. Reload the page.";
  }
  if (response.status === 403) {
    // El texto de reserva apuntaba al "Quick (curated) flow", que era
    // /api/curate — borrado con el catálogo de secciones. Un mensaje que manda
    // al usuario a un sitio inexistente es peor que uno genérico.
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    return data.message ?? "No podés generar esta página con tu cuenta ahora mismo.";
  }
  if (response.status === 429) {
    const data = (await response.json().catch(() => ({}))) as {
      scope?: string;
      plan?: string;
      max?: number;
      resetAt?: string;
    };
    const scope = data.scope ?? "quota";
    const resetMsg = data.resetAt
      ? ` Resets ${formatRelativeReset(data.resetAt)}.`
      : "";
    const planMsg = data.plan === "free" ? " Upgrade to Pro for more." : "";
    return `You've hit your ${scope} limit${
      data.max ? ` of ${data.max} generations` : ""
    }.${resetMsg}${planMsg}`;
  }
  const text = await response.text().catch(() => response.statusText);
  return text || `Request failed (${response.status})`;
}

/**
 * Adónde van los eventos ya parseados.
 *
 * Los TROZOS no llegan a `setState`: se acumulan y se pintan como mucho una vez
 * por fotograma (`chunk`). El resto de eventos sí escriben directo, pero antes
 * vacían lo acumulado (`flush`) — ver la nota de orden dentro de `applyEvent`.
 */
export interface EventSink {
  setState: (updater: (prev: GenerationState) => GenerationState) => void;
  chunk: (kind: "html" | "reasoning", text: string) => void;
  flush: () => void;
}

/** Exportado sólo para poder fijarlo en pruebas — el hook es su único uso. */
export function applyEvent(rawEvent: string, sink: EventSink) {
  let event = "";
  const dataLines: string[] = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (!event || dataLines.length === 0) return;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
  } catch {
    return;
  }

  // EL ORDEN IMPORTA. Todo evento que no es un trozo vacía primero lo
  // acumulado: sin esto, un trozo pendiente se aplicaría DESPUÉS del
  // `regen-starting` que limpia el buffer, y el preview mezclaría la versión
  // descartada con la nueva.
  if (event !== "html_chunk" && event !== "reasoning_chunk") sink.flush();

  if (event === "reasoning_chunk" && typeof data.text === "string") {
    sink.chunk("reasoning", data.text);
  } else if (event === "html_chunk" && typeof data.text === "string") {
    sink.chunk("html", data.text);
  } else if (event === "critic-checking") {
    // S3 vision critic is rendering + scoring the page. Abstract progress
    // text only — never surface that "the AI is checking if it looks bad".
    sink.setState((prev) =>
      prev.kind === "generating"
        ? { ...prev, notice: "Checking visual quality…" }
        : prev,
    );
  } else if (event === "regen-starting") {
    // SE DICE QUÉ SE MIDIÓ.
    //
    // Esto mandaba un «Improving the design…» a secas y el motivo se tiraba a
    // propósito: «keep it abstract so we never tell the user their page looked
    // broken». Esa decisión era coherente cuando la página era una caja negra y
    // el defecto podía ser nuestro. Hoy el código del modelo ES el código de la
    // página, se puede leer en la pestaña de código, y esto no es un juicio:
    // es una MEDIDA del navegador sobre ese código.
    //
    // Callarlo es el mismo pecado que las transformaciones invisibles: pasa
    // algo, la página cambia, y no sabes por qué. Quien lee «el titular se
    // desborda a 375px» entiende lo que ocurre; quien lee «mejorando el diseño»
    // sólo ve que le tiraron su página.
    //
    // 🔴 EL BUFFER YA NO SE VACÍA. (decisión de Jesús, 2026-09-04)
    //
    // Se vaciaba porque detrás venía una reescritura ENTERA y había que evitar
    // que el preview mezclara la versión descartada con la nueva. Esa
    // reescritura está retirada: lo único que corre ahora es un arreglo
    // quirúrgico por ops sobre la MISMA página, en el servidor, que no manda
    // ningún `html_chunk`.
    //
    // Vaciar aquí dejaría el buffer en "" sin nada que lo rellene, y el lienzo
    // colgando del recuerdo de `paginaEnPantalla` para no enseñar un vacío. Eso
    // funcionaba, pero es sostener la pantalla con la red en vez de con el
    // suelo: cualquier hueco en el recuerdo se ve como «me borró la página»,
    // que es exactamente la queja que trajo esto aquí.
    //
    // Se conserva el aviso, que es honesto: el navegador midió algo y se está
    // arreglando. Lo que no se hace es quitarle la página de delante mientras.
    const razon = typeof data.reason === "string" ? data.reason.trim() : "";
    sink.setState((prev) =>
      prev.kind === "generating"
        ? {
            ...prev,
            notice: "Improving the design…",
            ...(razon ? { medido: razon } : {}),
          }
        : prev,
    );
  } else if (event === "pagina-escribiendo") {
    // LAS PÁGINAS EXTRA SE DICEN, con su nombre.
    //
    // Se escriben después de la portada y NO se pintan —el lienzo enseña la
    // portada terminada y verla borrarse para dibujar media página de
    // Servicios sería peor que no enseñar nada—. Pero callarlas del todo deja
    // un turno mudo de un minuto por página, que es exactamente cómo se siente
    // un turno colgado. Se dice qué se está escribiendo.
    const nombre = typeof data.title === "string" ? data.title.trim() : "";
    sink.setState((prev) =>
      prev.kind === "generating"
        ? { ...prev, notice: nombre ? `Escribiendo ${nombre}…` : "Escribiendo las demás páginas…" }
        : prev,
    );
  } else if (event === "project_saved") {
    const projectId = typeof data.projectId === "string" ? data.projectId : "";
    const title =
      typeof data.title === "string" ? data.title : "Untitled page";
    if (projectId) sink.setState(() => ({ kind: "done", projectId, title }));
  } else if (event === "error") {
    const message =
      typeof data.message === "string" ? data.message : "Generation failed";
    const noCredits = noCreditsRefill(data.code, data);
    sink.setState(() => ({
      kind: "error",
      message,
      ...(noCredits ? { noCredits } : {}),
    }));
  }
}

function formatRelativeReset(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "in a moment";
  const m = Math.round(ms / 60000);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h}h`;
  const d = Math.round(h / 24);
  return `in ${d}d`;
}
