"use client";

// COMENTAR UNA LÍNEA, en «Código» y en «Cambios» (la #8 de
// plans/len-agente-2026/notas/fase-5-taller.md). Como en el visor de diffs de
// Claude Code: se pulsa el número de una línea, se escribe qué cambiar, y el
// comentario se queda debajo de su línea esperando el siguiente mensaje del
// chat (`lib/workspace-v2/comentarios-de-lineas.ts`).
//
// Enter lo añade, Mayús+Enter es un salto de línea, Escape lo cancela SIN cerrar
// la lente (`preventDefault`: en /new React escucha en el propio `document`).
// Todo como TEXTO.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  MAX_COMENTARIO,
  comentariosDelChat,
  type ComentarioDeLinea,
  type NuevoComentario,
} from "@/lib/workspace-v2/comentarios-de-lineas";
import { ChatIcon, X } from "./icons";
import { CajaConMenciones, HiloEnLinea, hayMencion, mencionesDe, useArroba, type ContextoDeHilos, type EtiquetasDeHilos } from "./hilos-del-codigo";
import type { PersonaMencionable } from "@/lib/workspace-v2/menciones";

/** Con proyecto compartido o con Len: lo escrito con `@` abre un hilo en vez de esperar al chat. */
export interface MencionesDeLaCaja {
  readonly personas: readonly PersonaMencionable[];
  /** Toda la gente del proyecto y su color, para pintar las menciones mientras se escriben. */
  readonly gente: readonly PersonaMencionable[];
  readonly colorDe: (userId: string) => string;
  readonly conLen: boolean;
  readonly labels: EtiquetasDeHilos;
  readonly onHilo: (texto: string) => Promise<boolean>;
}

export interface EtiquetasDeComentar {
  /** El título del número: «Comentar la línea 16». */
  readonly comentarLinea: (n: number) => string;
  readonly placeholder: string;
  readonly anadir: string;
  readonly cancelar: string;
  readonly quitar: string;
  /** Bajo un comentario que espera: «va en tu próximo mensaje». */
  readonly enElMensaje: string;
  /** Ya hay el máximo esperando. */
  readonly tope: string;
}

const SIN: readonly ComentarioDeLinea[] = [];

/** Los comentarios que esperan sobre un fichero, y cómo añadir y quitar. */
export function useComentarLineas(projectId: string | null | undefined, ruta: string | null) {
  const todos = useSyncExternalStore(
    comentariosDelChat.subscribe,
    () => (projectId ? comentariosDelChat.lista(projectId) : SIN),
    () => SIN,
  );
  const delFichero = useMemo(() => (ruta ? todos.filter((c) => c.ruta === ruta) : SIN), [todos, ruta]);
  // Qué línea tiene la caja abierta: `d16` (la 16 de ahora) o `a16` (la 16 de antes).
  const [abierta, setAbierta] = useState<string | null>(null);
  const [lleno, setLleno] = useState(false);
  // Otro fichero: la caja era de una línea del anterior.
  useEffect(() => setAbierta(null), [ruta]);
  return {
    activo: Boolean(projectId && ruta),
    abierta,
    abrir: (clave: string) => {
      setLleno(false);
      setAbierta(clave);
    },
    cerrar: () => setAbierta(null),
    deLaLinea: (linea: number, deAntes: boolean) => delFichero.filter((c) => c.linea === linea && Boolean(c.deAntes) === deAntes),
    anadir: (c: Omit<NuevoComentario, "ruta">) => {
      if (!projectId || !ruta) return;
      const hecho = comentariosDelChat.anadir(projectId, { ...c, ruta });
      if (hecho) setAbierta(null);
      else setLleno(true);
    },
    lleno,
    quitar: (id: number) => {
      if (projectId) comentariosDelChat.quitar(projectId, id);
    },
  };
}

export const claveDeLinea = (linea: number, deAntes: boolean) => `${deAntes ? "a" : "d"}${linea}`;

/** El número de la línea, como botón: pulsarlo abre la caja de comentar. */
export function NumeroComentable({
  n,
  conComentario,
  onComentar,
  label,
  className = "",
}: {
  n: number;
  conComentario: boolean;
  onComentar: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onComentar}
      title={label}
      aria-label={label}
      data-comentar-linea={n}
      className={`shrink-0 select-none text-right tabular hover:text-accent hover:underline ${conComentario ? "text-accent" : "fg-faint"} ${className}`}
    >
      {n}
    </button>
  );
}

/** La caja para escribir el comentario de una línea. */
export function CajaDeComentario({
  onAnadir,
  onCancelar,
  lleno,
  labels,
  menciones,
}: {
  onAnadir: (texto: string) => void;
  onCancelar: () => void;
  lleno: boolean;
  labels: EtiquetasDeComentar;
  menciones?: MencionesDeLaCaja;
}) {
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const arroba = useArroba(texto, setTexto, ref, menciones?.personas ?? [], menciones?.conLen ?? false, menciones?.colorDe);
  const conMencion = Boolean(menciones && hayMencion(mencionesDe(texto, menciones.personas)));
  // Con `@`: un hilo (se guarda y avisa). Sin él: espera al próximo mensaje, como siempre.
  const enviar = async () => {
    if (!texto.trim() || enviando) return;
    if (!menciones || !conMencion) return onAnadir(texto);
    const m = mencionesDe(texto, menciones.personas);
    if (m.len && !menciones.conLen) return setAviso(menciones.labels.soloEditoresLen);
    setEnviando(true);
    const ok = await menciones.onHilo(texto);
    setEnviando(false);
    if (!ok) setAviso(menciones.labels.error);
  };
  const caja = {
    value: texto,
    rows: 2,
    maxLength: MAX_COMENTARIO,
    placeholder: menciones ? menciones.labels.placeholder : labels.placeholder,
    "aria-label": labels.placeholder,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setTexto(e.target.value);
      arroba.onSeleccion(e);
    },
    onSelect: arroba.onSeleccion,
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (arroba.tecla(e)) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void enviar();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancelar();
      }
    },
  };
  return (
    <span className="my-1 ml-9 mr-3 block rounded-md border bd bg-elev p-2 font-sans whitespace-normal" data-caja-de-comentario="">
      {/* Con gente o Len a quien mencionar, las menciones se pintan mientras se escriben. */}
      {menciones ? (
        <CajaConMenciones
          cajaRef={ref}
          gente={menciones.gente}
          colorDe={menciones.colorDe}
          medida="text-[12px] leading-snug"
          className="placeholder:fg-faint focus:outline-none"
          {...caja}
        />
      ) : (
        <textarea
          ref={ref}
          {...caja}
          className="block w-full resize-none bg-transparent text-[12px] leading-snug fg placeholder:fg-faint focus:outline-none"
        />
      )}
      {arroba.menu}
      {lleno && <span className="mt-1 block text-[11px] text-accent">{labels.tope}</span>}
      {aviso && <span className="mt-1 block text-[11px] text-accent">{aviso}</span>}
      <span className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={onCancelar} className="rounded-md px-2 py-0.5 text-[11px] fg-muted hover:fg hover:bg-hover">
          {labels.cancelar}
        </button>
        <button
          type="button"
          disabled={!texto.trim() || enviando}
          onClick={() => void enviar()}
          className="rounded-md bg-[var(--accent-strong)] px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40"
        >
          {conMencion && menciones ? menciones.labels.comentar : labels.anadir}
        </button>
      </span>
    </span>
  );
}

/** Un comentario que espera el siguiente mensaje, bajo su línea. */
export function ComentarioPendiente({
  comentario,
  onQuitar,
  labels,
}: {
  comentario: ComentarioDeLinea;
  onQuitar: () => void;
  labels: EtiquetasDeComentar;
}) {
  return (
    <span
      className="my-1 ml-9 mr-3 flex items-start gap-1.5 rounded-md border border-[color:var(--accent)]/40 bg-accent-soft px-2 py-1 font-sans text-[11.5px] whitespace-normal"
      data-comentario-pendiente=""
    >
      <ChatIcon size={11} className="mt-0.5 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words fg">{comentario.texto}</span>
      <span className="shrink-0 text-[10px] fg-faint">{labels.enElMensaje}</span>
      <button
        type="button"
        onClick={onQuitar}
        aria-label={labels.quitar}
        className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded fg-faint hover:fg hover:bg-hover"
      >
        <X size={10} />
      </button>
    </span>
  );
}

/** Lo que va debajo de una línea: su caja abierta y los comentarios que esperan. */
export function DebajoDeLaLinea({
  comentar,
  linea,
  deAntes,
  codigo,
  labels,
  hilos,
}: {
  comentar: ReturnType<typeof useComentarLineas>;
  linea: number;
  deAntes: boolean;
  codigo: string;
  labels: EtiquetasDeComentar;
  /** Los hilos del fichero (sólo en «Código», con las líneas de ahora). */
  hilos?: { readonly ctx: ContextoDeHilos; readonly labels: EtiquetasDeHilos };
}): ReactNode {
  const clave = claveDeLinea(linea, deAntes);
  const pendientes = comentar.deLaLinea(linea, deAntes);
  const hilosDeLaLinea = hilos && !deAntes ? hilos.ctx.hilosDeLaLinea(linea) : [];
  if (comentar.abierta !== clave && pendientes.length === 0 && hilosDeLaLinea.length === 0) return null;
  const datos = hilos?.ctx.datos;
  const menciones: MencionesDeLaCaja | undefined =
    hilos && datos && !deAntes && (hilos.ctx.personas.length > 0 || datos.puedeLen)
      ? {
          personas: hilos.ctx.personas,
          gente: hilos.ctx.gente,
          colorDe: hilos.ctx.colorDe,
          conLen: datos.puedeLen,
          labels: hilos.labels,
          onHilo: async (texto) => {
            const ok = await hilos.ctx.crear(linea, codigo, texto);
            if (ok) comentar.cerrar();
            return ok;
          },
        }
      : undefined;
  return (
    <>
      {hilosDeLaLinea.map((h) => (
        <HiloEnLinea key={h.id} hilo={h} ctx={hilos!.ctx} labels={hilos!.labels} />
      ))}
      {pendientes.map((c) => (
        <ComentarioPendiente key={c.id} comentario={c} onQuitar={() => comentar.quitar(c.id)} labels={labels} />
      ))}
      {comentar.abierta === clave && (
        <CajaDeComentario
          lleno={comentar.lleno}
          labels={labels}
          onCancelar={comentar.cerrar}
          onAnadir={(texto) => comentar.anadir({ linea, codigo, texto, ...(deAntes ? { deAntes: true } : {}) })}
          {...(menciones ? { menciones } : {})}
        />
      )}
    </>
  );
}
