// El hilo del chat de la app: la conversación guardada de esa página (la MISMA
// que el Chat de la web), lo que pasa en esta sesión (lo que mandas, tus
// notas, la llamada) y el turno que corre ahora. Puro: la pantalla sólo pinta.
// Sin pasos ni herramientas: el chat del móvil no es el de la web.
import type { StoredChatTurn } from "@/lib/projects/types";
import { tarjetaDeConfirmacion, type TarjetaDeLlamada } from "@/components/llamada/puente-a-len";
import type { EventoSse } from "@/lib/len-bench/sse";

export type EstadoLocal = "ok" | "enviando" | "noSeEnvio" | "noSeSubio" | "transcribiendo" | "noSeEntendio";

export type ElementoDelHilo =
  | { clave: string; t: number; tipo: "tu"; texto: string; foto?: string; estado: EstadoLocal }
  | { clave: string; t: number; tipo: "voz"; url: string; barras: number[]; segundos: number; transcripcion: string | null; estado: EstadoLocal }
  | { clave: string; t: number; tipo: "len"; texto: string }
  | { clave: string; t: number; tipo: "verEnTuPagina" }
  | { clave: string; t: number; tipo: "fallo" }
  | { clave: string; t: number; tipo: "tarjeta"; tarjeta: TarjetaDeLlamada }
  | { clave: string; t: number; tipo: "llamada"; segundos: number }
  | { clave: string; t: number; tipo: "aviso"; aviso: "sinMicro" | "tope" }
  | { clave: string; t: number; tipo: "dia"; dia: string };

export interface TurnoEnVivo {
  turnoId: string | null;
  texto: string;
  /** La herramienta que corre (o la última que corrió): la línea bajo su nombre. */
  avance: string | null;
  pregunta: boolean;
  tarjetas: TarjetaDeLlamada[];
  cambioLaPagina: boolean;
  error: boolean;
  terminado: boolean;
}

/** Lo que dijo Len, una burbuja por párrafo; las marcas de markdown fuera
 *  (en una burbuja se leen como asteriscos sueltos). */
export function parrafos(texto: string): string[] {
  return texto
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/gm, "")
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean);
}

export function hiloDesdeElHistorial(turnos: StoredChatTurn[], ahora: number): ElementoDelHilo[] {
  const salida: ElementoDelHilo[] = [];
  for (const turno of turnos) {
    const t = turno.appliedAt ?? ahora;
    if (turno.userText.trim() || turno.attachedImage) {
      salida.push({ clave: `${turno.id}:tu`, t, tipo: "tu", texto: turno.userText.trim(), foto: turno.attachedImage?.url, estado: "ok" });
    }
    // En curso: lo que lleva dicho lo pinta el turno en vivo (o el reenganche).
    if (turno.enCurso) continue;
    parrafos(turno.assistantReasoning).forEach((texto, i) => salida.push({ clave: `${turno.id}:len:${i}`, t, tipo: "len", texto }));
    if (turno.status === "error") salida.push({ clave: `${turno.id}:fallo`, t, tipo: "fallo" });
    else if (turno.status === "applied" && !turno.noDocChange) salida.push({ clave: `${turno.id}:ver`, t, tipo: "verEnTuPagina" });
  }
  return salida;
}

/** Len cerró su último turno preguntándote algo (la herramienta `preguntar`) y aún no le contestas. */
export function terminaEnPregunta(turnos: StoredChatTurn[]): boolean {
  const u = turnos.at(-1);
  return !!u && !u.enCurso && (u.actions ?? []).some((a) => a.tool === "preguntar");
}

export function turnoNuevo(): TurnoEnVivo {
  return { turnoId: null, texto: "", avance: null, pregunta: false, tarjetas: [], cambioLaPagina: false, error: false, terminado: false };
}

/** Un evento del stream de /api/agent (los de `AgentStreamEvent` en lib/agent/loop.ts). */
export function conEvento(v: TurnoEnVivo, e: EventoSse): TurnoEnVivo {
  const d = (e.datos ?? {}) as Record<string, unknown>;
  switch (e.nombre) {
    case "turno":
      return typeof d.turnoId === "string" ? { ...v, turnoId: d.turnoId } : v;
    case "text":
      return typeof d.text === "string" ? { ...v, texto: v.texto + d.text } : v;
    case "action": {
      if (typeof d.tool !== "string") return v;
      if (d.tool === "preguntar") return { ...v, pregunta: true, avance: null };
      // La línea la cambia la siguiente herramienta, no el final de ésta: así no parpadea vacía entre una y otra.
      return d.status === "running" || v.avance === null ? { ...v, avance: d.tool } : v;
    }
    case "confirm": {
      const tarjeta = tarjetaDeConfirmacion(d);
      return tarjeta ? { ...v, tarjetas: [...v.tarjetas, tarjeta] } : v;
    }
    case "html":
      return { ...v, cambioLaPagina: true };
    case "error":
      return { ...v, error: true, terminado: true, avance: null };
    case "done":
      return { ...v, terminado: true, avance: null };
    default:
      return v;
  }
}

/** Lo que el turno en vivo pone en el hilo. `t`: ahora — el turno que corre es siempre lo último. */
export function elementosDelTurno(v: TurnoEnVivo, t: number): ElementoDelHilo[] {
  const s: ElementoDelHilo[] = parrafos(v.texto).map((texto, i): ElementoDelHilo => ({ clave: `vivo:len:${i}`, t, tipo: "len", texto }));
  v.tarjetas.forEach((tarjeta, i) => s.push({ clave: `vivo:tarjeta:${i}`, t, tipo: "tarjeta", tarjeta }));
  if (v.error) s.push({ clave: "vivo:fallo", t, tipo: "fallo" });
  else if (v.terminado && v.cambioLaPagina) s.push({ clave: "vivo:ver", t, tipo: "verEnTuPagina" });
  return s;
}

/** Junta las partes por hora (a la misma hora, en el orden de las partes y
 *  dentro de cada una) y pone el separador de cada día. */
export function hiloCompleto(partes: ElementoDelHilo[][], diaDe: (t: number) => string): ElementoDelHilo[] {
  const todos = partes.flatMap((p, k) => p.map((e, i) => ({ e, k, i })));
  todos.sort((a, b) => a.e.t - b.e.t || a.k - b.k || a.i - b.i);
  const salida: ElementoDelHilo[] = [];
  let dia = "";
  for (const { e } of todos) {
    const d = diaDe(e.t);
    if (d !== dia) {
      dia = d;
      salida.push({ clave: `dia:${d}`, t: e.t, tipo: "dia", dia: d });
    }
    salida.push(e);
  }
  return salida;
}

export function diaLocal(t: number): string {
  const f = new Date(t);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

export function cualDia(dia: string, hoy: string): "hoy" | "ayer" | "otro" {
  if (dia === hoy) return "hoy";
  const ayer = new Date(`${hoy}T12:00:00Z`);
  ayer.setUTCDate(ayer.getUTCDate() - 1);
  return ayer.toISOString().slice(0, 10) === dia ? "ayer" : "otro";
}

export function marcar(ls: ElementoDelHilo[], clave: string, c: { estado?: EstadoLocal; transcripcion?: string }): ElementoDelHilo[] {
  return ls.map((e) => {
    if (e.clave !== clave) return e;
    if (e.tipo === "tu") return c.estado ? { ...e, estado: c.estado } : e;
    if (e.tipo === "voz") {
      return { ...e, ...(c.estado ? { estado: c.estado } : {}), ...(c.transcripcion !== undefined ? { transcripcion: c.transcripcion } : {}) };
    }
    return e;
  });
}

/** Lo que ya salió está en la conversación guardada (releída al acabar el
 *  turno): se quita de lo local. Lo que falló se queda, con su «Reintentar». */
export function sinLoEnviado(ls: ElementoDelHilo[]): ElementoDelHilo[] {
  return ls.filter((e) => !((e.tipo === "tu" || e.tipo === "voz") && e.estado === "ok"));
}

// La herramienta → la frase bajo su nombre (movil.chat.avance.*). `summary`
// del evento no sirve: trae códigos («no-mirado», «regresion»), no frases.
const AVANCES: Record<string, string> = {
  Read: "leyendo",
  Grep: "leyendo",
  Glob: "leyendo",
  Edit: "cambiando",
  Write: "cambiando",
  editar_imagen: "cambiando",
  mirar_pagina: "comprobando",
  usar_pagina: "comprobando",
  verificar_diseno: "comprobando",
  elegir_foto: "fotos",
  leer_de_internet: "internet",
  ver_visitas: "visitas",
  ver_formularios: "formularios",
  ver_mensajes: "mensajes",
  preparar_respuesta: "borrador",
  publicar: "publicar",
  activar_modulo: "modulo",
  revertir_ultimo_cambio: "deshaciendo",
};

export function claveDeAvance(herramienta: string | null): string | null {
  return herramienta ? (AVANCES[herramienta] ?? "trabajando") : null;
}
