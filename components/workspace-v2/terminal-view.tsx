"use client";

// La terminal de Len, a la vista (F6a de plans/len-agente-2026).
//
// POR QUÉ EXISTE. Con `OPENLEN_TERMINAL=1` Len trabaja en una terminal sobre los
// ficheros del sitio (`grep`, `sed -i`, `jq`…). Para quien programa, ver los
// comandos y lo que imprimieron es la forma más rápida de fiarse —o no— de lo
// que hizo; quien no programa no tiene por qué abrirla. Es la misma razón que el
// visor de código: una caja negra es una razón para no usarte.
//
// SÓLO LECTURA a propósito. Que el usuario escriba comandos es F6b, y es una
// decisión de Jesús (D1), no de esta vista.
//
// Todo va como TEXTO dentro de <pre>: ni el comando ni su salida se interpretan
// nunca (la salida puede traer HTML de la página o filas de visitantes).

import { useEffect, useMemo, useRef, useState } from "react";

import { cabezaYCola, plegarSalida } from "@/lib/workspace-v2/salida-de-la-tarjeta";
import { copiar } from "./copiar";
import { Check, Copy, X } from "./icons";
import { IconBtn } from "./ui";
import type { TerminalDeLen } from "./use-terminal-de-len";

interface TerminalViewProps {
  readonly terminal: TerminalDeLen;
  readonly onClose: () => void;
  readonly labels: {
    readonly title: string;
    readonly close: string;
    readonly soloLectura: string;
    readonly vacio: string;
    readonly apagada: string;
    readonly error: string;
    readonly enVivo: string;
    readonly sinSalida: string;
    readonly codigo: (n: number) => string;
    readonly copiar: string;
    readonly copiado: string;
    /** «N líneas más», en medio de una salida plegada. */
    readonly ocultas: (n: number) => string;
    readonly plegar: string;
  };
}

function Comando({
  command,
  salida,
  exitCode,
  labels,
}: {
  command: string;
  salida: string | null;
  exitCode: number | null;
  labels: TerminalViewProps["labels"];
}) {
  // La última línea ya dice el código de salida («[Command finished with exit
  // code N]»): se quita del cuerpo y se pinta aparte, con el acento si no es 0.
  const lineas = useMemo(() => (salida === null ? [] : plegarSalida(salida).lineas), [salida]);
  // PLEGADA SI ES LARGA (la #14 de plans/len-agente-2026/notas/fase-5-taller.md),
  // como el bloque de terminal de DeepSeek: las 8 primeras, cuántas faltan, y
  // las 8 últimas. Antes cada salida tenía su propia caja con scroll dentro de
  // la lente, que también tiene scroll: dos ruedas para leer una cosa.
  const { cabeza, ocultas, cola } = cabezaYCola(lineas);
  const [entera, setEntera] = useState(false);
  // COPIAR, sólo lo que imprimió: ni el `$`, ni el comando, ni la línea del código.
  const texto = lineas.join("\n");
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1600);
    return () => clearTimeout(t);
  }, [copiado]);
  const falla = exitCode !== null && exitCode !== 0;
  const caja = "whitespace-pre-wrap break-words";
  return (
    <div className="border-b bd px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.55]">
          <span className="select-none text-accent">$ </span>
          <span className="fg">{command}</span>
        </pre>
        {texto && (
          <button
            type="button"
            onClick={() => void copiar(texto).then(setCopiado)}
            className="shrink-0 inline-flex items-center gap-1 rounded-md border bd px-1.5 py-0.5 text-[10.5px] fg-faint hover:fg hover:bg-hover transition ui-small"
          >
            {copiado ? <Check size={10} /> : <Copy size={10} />}
            {copiado ? labels.copiado : labels.copiar}
          </button>
        )}
      </div>
      {salida === null ? (
        <p className="mt-1 text-[11px] fg-faint ui-small">{labels.sinSalida}</p>
      ) : (
        lineas.length > 0 && (
          <div className="mt-1 font-mono text-[11px] leading-[1.5] fg-muted">
            <pre className={caja}>{(entera || ocultas === 0 ? lineas : cabeza).join("\n")}</pre>
            {ocultas > 0 && (
              <button
                type="button"
                aria-expanded={entera}
                onClick={() => setEntera((x) => !x)}
                className="my-0.5 text-[10.5px] text-accent hover:underline ui-small"
              >
                {entera ? labels.plegar : labels.ocultas(ocultas)}
              </button>
            )}
            {ocultas > 0 && !entera && <pre className={caja}>{cola.join("\n")}</pre>}
          </div>
        )
      )}
      {falla && (
        <p className="mt-1 font-mono text-[10.5px] text-accent">{labels.codigo(exitCode)}</p>
      )}
    </div>
  );
}

function fecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export function TerminalView({ terminal, onClose, labels }: TerminalViewProps) {
  const { turnos, enVivo, encendida, cargando, error } = terminal;
  const finalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Como una terminal: lo último, abajo y a la vista. Cada comando nuevo baja.
  const total = turnos.reduce((n, t) => n + t.comandos.length, 0) + enVivo.length;
  useEffect(() => {
    finalRef.current?.scrollIntoView({ block: "end" });
  }, [total]);

  const vacia = total === 0;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-app">
      <div className="flex items-center gap-2 border-b bd px-3 py-2">
        <span className="text-[12px] font-medium fg ui-small">{labels.title}</span>
        <span className="text-[10.5px] fg-faint ui-small">{labels.soloLectura}</span>
        <div className="ml-auto">
          <IconBtn label={labels.close} size="sm" onClick={onClose}>
            <X size={12} />
          </IconBtn>
        </div>
      </div>
      <div className="flex-1 overflow-auto nice-scroll">
        {error && <p className="px-3 py-2 text-[11.5px] fg-muted ui-small">{labels.error}</p>}
        {vacia && !cargando && !error && (
          <p className="px-3 py-6 text-center text-[12px] fg-muted ui-small">
            {encendida ? labels.vacio : labels.apagada}
          </p>
        )}
        {turnos.map((turno) => (
          <section key={turno.id} className="min-w-0">
            <header className="sticky top-0 z-10 flex items-baseline gap-2 border-b bd bg-elev px-3 py-1.5">
              <span className="min-w-0 truncate text-[11px] font-medium fg-muted ui-small">{turno.pedido}</span>
              <span className="ml-auto shrink-0 text-[10.5px] fg-faint tabular ui-small">{fecha(turno.creado)}</span>
            </header>
            {turno.comandos.map((c, i) => (
              <Comando key={i} command={c.command} salida={c.salida} exitCode={c.exitCode} labels={labels} />
            ))}
          </section>
        ))}
        {enVivo.length > 0 && (
          <section className="min-w-0">
            <header className="sticky top-0 z-10 flex items-center gap-2 border-b bd bg-elev px-3 py-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              <span className="text-[11px] font-medium fg-muted ui-small">{labels.enVivo}</span>
            </header>
            {enVivo.map((c, i) => (
              <Comando key={i} command={c.command} salida={c.salida} exitCode={c.exitCode} labels={labels} />
            ))}
          </section>
        )}
        <div ref={finalRef} />
      </div>
    </div>
  );
}
