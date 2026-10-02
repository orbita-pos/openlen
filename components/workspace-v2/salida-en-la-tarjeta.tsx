"use client";

// LA SALIDA DE UN COMANDO, DESPLEGADA EN SU TARJETA DEL CHAT (la #5 de
// plans/len-agente-2026/notas/fase-5-taller.md).
//
// Como Claude Code: el comando entero y las tres primeras líneas de lo que
// imprimió; «+N líneas» lo enseña todo, en una caja con su propio scroll (la
// misma que la lente «Terminal»). El código distinto de 0, aparte.
//
// De dónde sale: del almacén en vivo durante el turno (`terminalEnVivo`, que el
// Chat llena con el evento `terminal`) y, si no está —un turno de antes de
// recargar—, de `GET /api/projects/[id]/terminal`, la misma ruta de la lente,
// pedida UNA vez por proyecto y sólo cuando alguien despliega. Ver
// `lib/workspace-v2/salida-de-la-tarjeta.ts` para cómo se casa cada tarjeta con
// su comando.
//
// Todo va como TEXTO: la salida puede traer HTML de la página o filas de visitantes.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { plegarSalida, salidaDelComando, type ComandoConSalida } from "@/lib/workspace-v2/salida-de-la-tarjeta";
import { terminalEnVivo } from "@/lib/workspace-v2/terminal-en-vivo";
import { CambiosDelComandoView } from "./cambios-del-comando";

interface TurnoGuardado {
  readonly id: string;
  readonly comandos: readonly ComandoConSalida[];
}

/** El historial de la lente, por proyecto: una petición aunque se desplieguen diez tarjetas. */
const historiales = new Map<string, Promise<readonly TurnoGuardado[]>>();

function historial(projectId: string, fresco: boolean): Promise<readonly TurnoGuardado[]> {
  const ya = historiales.get(projectId);
  if (ya && !fresco) return ya;
  const p = fetch(`/api/projects/${projectId}/terminal`, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ turnos?: unknown }>) : Promise.reject(new Error(String(r.status)))))
    .then((j) => (Array.isArray(j.turnos) ? (j.turnos as TurnoGuardado[]) : []));
  // Un fallo no se queda en la caché: el siguiente despliegue lo vuelve a intentar.
  p.catch(() => historiales.delete(projectId));
  historiales.set(projectId, p);
  return p;
}

export interface DondeEstaLaSalida {
  readonly projectId: string;
  readonly turnId: string;
  /** Posición entre las tarjetas de `bash` del turno. */
  readonly indice: number;
}

export function SalidaEnLaTarjeta({
  donde,
  resumen,
  fallo,
  onAbrirFichero,
}: {
  donde: DondeEstaLaSalida;
  /** `action.summary`: el resumen con el que se confirma la pareja. */
  resumen: string;
  /** La tarjeta salió roja: el código va en rojo, no atenuado. */
  fallo: boolean;
  /** Abre en el taller un fichero que cambió el comando (la #9). */
  onAbrirFichero?: (ruta: string) => void;
}) {
  const t = useTranslations("wsPage");
  const tc = useTranslations("wsChrome");
  const { projectId, turnId, indice } = donde;

  const vivos = useSyncExternalStore(
    terminalEnVivo.subscribe,
    () => terminalEnVivo.comandos(projectId),
    () => terminalEnVivo.comandos(projectId),
  );
  const enVivo = useMemo(
    () => salidaDelComando(vivos.filter((c) => c.turnId === turnId), indice, resumen),
    [vivos, turnId, indice, resumen],
  );

  const [guardado, setGuardado] = useState<ComandoConSalida | "buscando" | "no-esta" | "error">("buscando");
  useEffect(() => {
    if (enVivo) return;
    let vivo = true;
    const buscar = (fresco: boolean): Promise<void> =>
      historial(projectId, fresco).then((turnos) => {
        if (!vivo) return;
        const turno = turnos.find((x) => x.id === turnId);
        const c = turno ? salidaDelComando(turno.comandos, indice, resumen) : null;
        if (c) setGuardado(c);
        // Lo guardado puede ser de antes de este turno: se pide una vez más, fresco.
        else if (!fresco) return buscar(true);
        else setGuardado("no-esta");
      });
    buscar(false).catch(() => vivo && setGuardado("error"));
    return () => {
      vivo = false;
    };
  }, [enVivo, projectId, turnId, indice, resumen]);

  const comando = enVivo ?? (typeof guardado === "string" ? null : guardado);
  const [entera, setEntera] = useState(false);
  const plegada = useMemo(() => (comando?.salida != null ? plegarSalida(comando.salida) : null), [comando]);
  const codigo = comando?.exitCode;

  return (
    <div className="border-t bd px-2.5 py-2 font-mono text-[11px] leading-[1.5]">
      {comando ? (
        <pre className="whitespace-pre-wrap break-words">
          <span className="select-none text-accent">$ </span>
          <span className="fg">{comando.command}</span>
        </pre>
      ) : (
        <p className="fg-faint ui-small">
          {guardado === "buscando" ? t("agent.terminal.cargando") : guardado === "error" ? tc("preview.terminal.error") : tc("preview.terminal.sinSalida")}
        </p>
      )}
      {comando && !plegada && <p className="mt-1 fg-faint ui-small">{tc("preview.terminal.sinSalida")}</p>}
      {plegada && plegada.lineas.length === 0 && <p className="mt-1 fg-faint ui-small">{t("agent.terminal.vacia")}</p>}
      {plegada && plegada.lineas.length > 0 &&
        (entera ? (
          <pre className="mt-1 max-h-[22rem] overflow-auto nice-scroll whitespace-pre-wrap break-words fg-muted">
            {plegada.lineas.join("\n")}
          </pre>
        ) : (
          // Plegada, UNA fila por línea y cortada con «…»: así «+N líneas» dice
          // exactamente lo que falta. Partirlas al ancho hacía que una línea
          // larga se comiera el sitio de la siguiente y el recuento no cuadraba.
          <div className="mt-1 fg-muted">
            {plegada.cabeza.map((linea, i) => (
              <div key={i} className="truncate whitespace-pre">
                {linea || " "}
              </div>
            ))}
          </div>
        ))}
      {plegada?.hayMas && (
        <button
          type="button"
          onClick={() => setEntera((x) => !x)}
          className="mt-1 text-accent hover:underline ui-small"
        >
          {entera
            ? t("agent.terminal.menos")
            : plegada.resto > 0
              ? t("agent.terminal.mas", { count: plegada.resto })
              : t("agent.terminal.todo")}
        </button>
      )}
      {/* > 0 y no ≠ 0: el almacén en vivo apunta -1 cuando el código no llegó. */}
      {typeof codigo === "number" && codigo > 0 && (
        <p className={`mt-1 text-[10.5px] ${fallo ? "text-red-600 dark:text-red-400" : "fg-faint"}`}>
          {tc("preview.terminal.codigo", { n: codigo })}
        </p>
      )}
      {/* La #10 · lo que cambió en los ficheros; aquí, sólo las cabeceras. */}
      {comando?.cambios && (
        <CambiosDelComandoView
          cambios={comando.cambios}
          conLineas={false}
          onAbrir={onAbrirFichero}
          labels={{
            creado: tc("preview.terminal.creado"),
            actualizado: tc("preview.terminal.actualizado"),
            borrado: tc("preview.terminal.borrado"),
            masLineas: (n) => tc("preview.terminal.masLineas", { count: n }),
            masFicheros: (n) => tc("preview.terminal.masFicheros", { count: n }),
            abrir: tc("preview.terminal.abrirFichero"),
          }}
        />
      )}
    </div>
  );
}
