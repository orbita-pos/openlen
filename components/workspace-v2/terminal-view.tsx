"use client";

// La terminal de Len, a la vista (F6a de plans/len-agente-2026).
//
// POR QUÉ EXISTE. Con `OPENLEN_TERMINAL=1` Len trabaja en una terminal sobre los
// ficheros del sitio (`grep`, `sed -i`, `jq`…). Para quien programa, ver los
// comandos y lo que imprimieron es la forma más rápida de fiarse —o no— de lo
// que hizo; quien no programa no tiene por qué abrirla. Es la misma razón que el
// visor de código: una caja negra es una razón para no usarte.
//
// LA TERMINAL DEL USUARIO, abajo (la #17 de plans/len-agente-2026/notas/
// fase-5-taller.md; Jesús: «las decisiones, como DeepSeek»). Como allí, una
// terminal TUYA aparte de la de Len: sus comandos no van a la conversación ni
// los ve el modelo; lo que cambien en los ficheros, sí. Sin `tuya` —la terminal
// apagada en el servidor— la lente sigue siendo de sólo lectura.
//
// Todo va como TEXTO dentro de <pre>: ni el comando ni su salida se interpretan
// nunca (la salida puede traer HTML de la página o filas de visitantes).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { cabezaYCola, plegarSalida } from "@/lib/workspace-v2/salida-de-la-tarjeta";
import { copiar } from "./copiar";
import { Check, Copy, Loader, X } from "./icons";
import { IconBtn } from "./ui";
import type { TerminalDeLen } from "./use-terminal-de-len";
import type { TerminalDelUsuario } from "./use-terminal-del-usuario";
import type { CambiosDelComando } from "@/lib/agent/terminal/cambios-del-comando";
import { CambiosDelComandoView, type EtiquetasDeLosCambios } from "./cambios-del-comando";

interface TerminalViewProps {
  readonly terminal: TerminalDeLen;
  /** La terminal del usuario; sin ella, la lente es de sólo lectura. */
  readonly tuya?: TerminalDelUsuario;
  readonly onClose: () => void;
  /** La ruta de un fichero que cambió un comando (la #10), con el turno que lo corrió; null, tu terminal. */
  readonly onAbrirFichero?: (ruta: string, turnId: string | null) => void;
  readonly labels: EtiquetasDeLosCambios & {
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
    // La terminal del usuario (la #17).
    readonly tuya: string;
    readonly escribe: string;
    readonly nota: string;
    readonly corriendo: string;
    readonly noCorrio: (motivo: string) => string;
  };
}

function Comando({
  command,
  salida,
  exitCode,
  corriendo = false,
  error,
  cambios,
  onAbrir,
  labels,
}: {
  command: string;
  salida: string | null;
  exitCode: number | null;
  /** Lo que cambió en los ficheros (la #10). */
  cambios?: CambiosDelComando | undefined;
  onAbrir?: ((ruta: string) => void) | undefined;
  /** De la terminal del usuario: todavía no ha vuelto. */
  corriendo?: boolean;
  /** De la terminal del usuario: no llegó a correr. */
  error?: string;
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
      {corriendo ? (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] fg-faint ui-small">
          <Loader size={11} className="animate-spin" />
          {labels.corriendo}
        </p>
      ) : error ? (
        <p className="mt-1 text-[11px] text-accent ui-small">{labels.noCorrio(error)}</p>
      ) : salida === null ? (
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
      {cambios && <CambiosDelComandoView cambios={cambios} conLineas onAbrir={onAbrir} labels={labels} />}
    </div>
  );
}

function fecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export function TerminalView({ terminal, tuya, onClose, onAbrirFichero, labels }: TerminalViewProps) {
  const { turnos, enVivo, encendida, cargando, error } = terminal;
  const finalRef = useRef<HTMLDivElement>(null);
  const [linea, setLinea] = useState("");
  // Las flechas recorren lo que ya escribiste, del último hacia atrás.
  const [atras, setAtras] = useState(0);

  // Un Escape que ya atendió la línea (`preventDefault`) no cierra: en /new
  // React escucha en el propio `document`, así que su `stopPropagation` no
  // frena a este oyente, que está en el mismo nodo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Como una terminal: lo último, abajo y a la vista. Cada comando nuevo baja.
  const tuyos = tuya?.comandos ?? [];
  const total = turnos.reduce((n, t) => n + t.comandos.length, 0) + enVivo.length;
  const salidasTuyas = tuyos.filter((c) => c.salida !== null || c.error).length;
  useEffect(() => {
    finalRef.current?.scrollIntoView({ block: "end" });
  }, [total, tuyos.length, salidasTuyas]);

  const vacia = total === 0 && tuyos.length === 0;

  const teclaEnLaLinea = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const siguiente = Math.max(0, Math.min(tuyos.length, atras + (e.key === "ArrowUp" ? 1 : -1)));
      setAtras(siguiente);
      setLinea(siguiente === 0 ? "" : tuyos[tuyos.length - siguiente]!.command);
    } else if (e.key === "Escape" && linea) {
      // Escape borra la línea; sólo con la línea vacía cierra la lente.
      e.preventDefault();
      e.stopPropagation();
      setLinea("");
      setAtras(0);
    }
  };
  const enviar = () => {
    if (!tuya || tuya.corriendo || !linea.trim()) return;
    void tuya.ejecutar(linea);
    setLinea("");
    setAtras(0);
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-app">
      <div className="flex items-center gap-2 border-b bd px-3 py-2">
        <span className="text-[12px] font-medium fg ui-small">{labels.title}</span>
        {!tuya && <span className="text-[10.5px] fg-faint ui-small">{labels.soloLectura}</span>}
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
              <Comando
                key={i}
                command={c.command}
                salida={c.salida}
                exitCode={c.exitCode}
                cambios={c.cambios}
                onAbrir={onAbrirFichero && ((ruta) => onAbrirFichero(ruta, turno.id))}
                labels={labels}
              />
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
              <Comando
                key={i}
                command={c.command}
                salida={c.salida}
                exitCode={c.exitCode}
                cambios={c.cambios}
                onAbrir={onAbrirFichero && ((ruta) => onAbrirFichero(ruta, c.turnId ?? null))}
                labels={labels}
              />
            ))}
          </section>
        )}
        {tuyos.length > 0 && (
          <section className="min-w-0">
            <header className="sticky top-0 z-10 flex items-center gap-2 border-b bd bg-elev px-3 py-1.5">
              <span className="text-[11px] font-medium fg-muted ui-small">{labels.tuya}</span>
            </header>
            {tuyos.map((c) => (
              <Comando
                key={c.n}
                command={c.command}
                salida={c.salida}
                exitCode={c.exitCode}
                corriendo={c.salida === null && !c.error}
                {...(c.error ? { error: c.error } : {})}
                cambios={c.cambios}
                onAbrir={onAbrirFichero && ((ruta) => onAbrirFichero(ruta, null))}
                labels={labels}
              />
            ))}
          </section>
        )}
        <div ref={finalRef} />
      </div>
      {tuya && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
          className="border-t bd px-3 py-2"
        >
          <label className="flex items-center gap-1.5 font-mono text-[11.5px]">
            <span className="select-none text-accent">$</span>
            <input
              value={linea}
              onChange={(e) => {
                setLinea(e.target.value);
                setAtras(0);
              }}
              onKeyDown={teclaEnLaLinea}
              placeholder={labels.escribe}
              aria-label={labels.escribe}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              className="min-w-0 flex-1 bg-transparent fg placeholder:fg-faint focus:outline-none"
            />
            {tuya.corriendo && <Loader size={11} className="shrink-0 animate-spin fg-faint" />}
          </label>
          <p className="mt-1 text-[10.5px] fg-faint ui-small">{labels.nota}</p>
        </form>
      )}
    </div>
  );
}
