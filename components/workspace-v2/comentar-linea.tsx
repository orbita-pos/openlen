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
}: {
  onAnadir: (texto: string) => void;
  onCancelar: () => void;
  lleno: boolean;
  labels: EtiquetasDeComentar;
}) {
  const [texto, setTexto] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <span className="my-1 ml-9 mr-3 block rounded-md border bd bg-elev p-2 font-sans whitespace-normal" data-caja-de-comentario="">
      <textarea
        ref={ref}
        value={texto}
        rows={2}
        maxLength={MAX_COMENTARIO}
        placeholder={labels.placeholder}
        aria-label={labels.placeholder}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (texto.trim()) onAnadir(texto);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancelar();
          }
        }}
        className="block w-full resize-none bg-transparent text-[12px] leading-snug fg placeholder:fg-faint focus:outline-none"
      />
      {lleno && <span className="mt-1 block text-[11px] text-accent">{labels.tope}</span>}
      <span className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={onCancelar} className="rounded-md px-2 py-0.5 text-[11px] fg-muted hover:fg hover:bg-hover">
          {labels.cancelar}
        </button>
        <button
          type="button"
          disabled={!texto.trim()}
          onClick={() => onAnadir(texto)}
          className="rounded-md bg-[var(--accent-strong)] px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40"
        >
          {labels.anadir}
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
}: {
  comentar: ReturnType<typeof useComentarLineas>;
  linea: number;
  deAntes: boolean;
  codigo: string;
  labels: EtiquetasDeComentar;
}): ReactNode {
  const clave = claveDeLinea(linea, deAntes);
  const pendientes = comentar.deLaLinea(linea, deAntes);
  if (comentar.abierta !== clave && pendientes.length === 0) return null;
  return (
    <>
      {pendientes.map((c) => (
        <ComentarioPendiente key={c.id} comentario={c} onQuitar={() => comentar.quitar(c.id)} labels={labels} />
      ))}
      {comentar.abierta === clave && (
        <CajaDeComentario
          lleno={comentar.lleno}
          labels={labels}
          onCancelar={comentar.cerrar}
          onAnadir={(texto) => comentar.anadir({ linea, codigo, texto, ...(deAntes ? { deAntes: true } : {}) })}
        />
      )}
    </>
  );
}
