"use client";

// LO QUE CAMBIÓ UN COMANDO, POR FICHERO, debajo de su salida (la #10 de
// plans/len-agente-2026/notas/fase-5-taller.md).
//
// Como Claude Code: «Actualizado ruta +N −M» y sus trozos, hasta 40 líneas por
// fichero (el servidor ya las recortó: `lib/agent/terminal/cambios-del-comando.ts`),
// «… N líneas más» y «… N archivos más cambiados». En la tarjeta del chat, que
// es estrecha, sólo las cabeceras: el estilo «condensed» de allí. La ruta abre
// el fichero en el taller, como las demás rutas del chat (la #9).
//
// Todo como TEXTO: las líneas son HTML de la página.

import type { CambiosDelComando, TipoDeCambio } from "@/lib/agent/terminal/cambios-del-comando";
import type { LineaDelDiff } from "@/lib/workspace-v2/diff-de-ficheros";

import { MasMenos } from "./ficheros-del-turno";

export interface EtiquetasDeLosCambios {
  readonly creado: string;
  readonly actualizado: string;
  readonly borrado: string;
  readonly masLineas: (n: number) => string;
  readonly masFicheros: (n: number) => string;
  readonly abrir: string;
}

const FONDO: Record<LineaDelDiff["tipo"], string> = {
  igual: "fg-muted",
  quitada: "bg-red-500/10 fg",
  anadida: "bg-emerald-500/10 fg",
};
const SIGNO: Record<LineaDelDiff["tipo"], string> = { igual: " ", quitada: "−", anadida: "+" };
const COLOR_DEL_SIGNO: Record<LineaDelDiff["tipo"], string> = {
  igual: "",
  quitada: "text-red-600 dark:text-red-400",
  anadida: "text-emerald-600 dark:text-emerald-400",
};

export function CambiosDelComandoView({
  cambios,
  conLineas,
  onAbrir,
  labels,
}: {
  cambios: CambiosDelComando;
  /** Con los trozos (la lente); sin ellos, sólo las cabeceras (la tarjeta). */
  conLineas: boolean;
  onAbrir?: ((ruta: string) => void) | undefined;
  labels: EtiquetasDeLosCambios;
}) {
  const tipo: Record<TipoDeCambio, string> = { creado: labels.creado, actualizado: labels.actualizado, borrado: labels.borrado };
  return (
    <div className="mt-1.5 space-y-1.5 font-mono text-[11px] leading-[1.5]" data-cambios-del-comando="">
      {cambios.ficheros.map((f) => {
        const ruta = f.ruta.replace(/^\/+/, "");
        return (
          <div key={f.ruta} className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 fg-muted">{tipo[f.tipo]}</span>
              {onAbrir ? (
                <button
                  type="button"
                  title={labels.abrir}
                  onClick={() => onAbrir(f.ruta)}
                  className="min-w-0 truncate font-medium fg hover:underline"
                >
                  {ruta}
                </button>
              ) : (
                <span className="min-w-0 truncate font-medium fg">{ruta}</span>
              )}
              <MasMenos anadidas={f.anadidas} quitadas={f.quitadas} />
            </div>
            {conLineas && f.trozos.length > 0 && (
              <div className="mt-0.5 overflow-x-auto nice-scroll rounded-md border bd">
                <div className="w-max min-w-full">
                  {f.trozos.map((t, k) => (
                    <div key={k}>
                      {k > 0 && <div className="select-none px-2 fg-faint">⋯</div>}
                      {t.lineas.map((l, j) => (
                        <div key={j} className={`flex ${FONDO[l.tipo]}`}>
                          <span className="w-9 shrink-0 select-none pr-1.5 text-right fg-faint tabular">{l.despues ?? l.antes}</span>
                          <span className={`w-3 shrink-0 select-none ${COLOR_DEL_SIGNO[l.tipo]}`}>{SIGNO[l.tipo]}</span>
                          <span className="whitespace-pre pr-3">{l.texto || " "}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {conLineas && f.ocultas > 0 && <p className="fg-faint">{labels.masLineas(f.ocultas)}</p>}
          </div>
        );
      })}
      {cambios.masFicheros > 0 && <p className="fg-faint">{labels.masFicheros(cambios.masFicheros)}</p>}
    </div>
  );
}
