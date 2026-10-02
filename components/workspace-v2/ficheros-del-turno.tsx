"use client";

// LOS FICHEROS QUE CAMBIÓ EL TURNO, al pie del turno en el Chat
// (plans/len-agente-2026). Es la tarjeta de DeepSeek
// (`2026-09-11-turn-changed-files-card.md`): cuántos ficheros y cuántas líneas
// arriba, tres filas y «ver más». Cada fila abre la lente «Cambios» en su
// fichero; la cabecera, en el primero.
//
// La lista de SECCIONES que ya sale en el pie del turno (`CambiosDelTurno`) se
// queda: ésa la lee quien no programa; ésta, quien quiere ver el código.

import { useMemo, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { FileDiff } from "lucide-react";

import type { FicheroCambiado } from "@/lib/agent/cambios-del-turno";
import { cambiosEnVivo, type CambiosDeUnTurno } from "@/lib/workspace-v2/cambios-en-vivo";
import { diffDeFichero } from "@/lib/workspace-v2/diff-de-ficheros";

/** Filas a la vista antes de «ver más», como allí. */
const FILAS = 3;

export interface CuentaDeFichero {
  readonly ruta: string;
  readonly anadidas: number | null;
  readonly quitadas: number | null;
  readonly nuevo: boolean;
  readonly borrado: boolean;
  readonly grande: boolean;
}

/** Las líneas de cada fichero, con la MISMA cuenta que la lente. */
export function cuentasDe(ficheros: readonly FicheroCambiado[]): CuentaDeFichero[] {
  return ficheros.map((f) => {
    if (f.tipo === "grande") {
      return { ruta: f.ruta, anadidas: null, quitadas: null, nuevo: f.nuevo, borrado: f.borrado, grande: true };
    }
    const d = diffDeFichero(f.antes, f.despues);
    return {
      ruta: f.ruta,
      anadidas: d.anadidas,
      quitadas: d.quitadas,
      nuevo: f.antes === null,
      borrado: f.despues === null,
      grande: false,
    };
  });
}

export function MasMenos({ anadidas, quitadas }: { anadidas: number | null; quitadas: number | null }) {
  if (anadidas === null || quitadas === null) return null;
  return (
    <span className="shrink-0 tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{anadidas}</span>{" "}
      <span className="text-red-600 dark:text-red-400">−{quitadas}</span>
    </span>
  );
}

export function FicherosDelTurno({
  ficheros,
  onAbrir,
}: {
  ficheros: readonly FicheroCambiado[];
  onAbrir: (ruta: string | null) => void;
}) {
  const t = useTranslations("wsChrome");
  const [todas, setTodas] = useState(false);
  const cuentas = useMemo(() => cuentasDe(ficheros), [ficheros]);
  if (cuentas.length === 0) return null;
  const anadidas = cuentas.reduce((s, c) => s + (c.anadidas ?? 0), 0);
  const quitadas = cuentas.reduce((s, c) => s + (c.quitadas ?? 0), 0);
  const visibles = todas ? cuentas : cuentas.slice(0, FILAS);
  const resto = cuentas.length - FILAS;

  return (
    <div className="mt-1.5 max-w-full overflow-hidden rounded-lg border bd bg-app text-[11px] ui-small">
      <button
        type="button"
        onClick={() => onAbrir(null)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-hover"
      >
        <FileDiff size={11} className="shrink-0 text-[var(--accent)]" />
        <span className="min-w-0 truncate fg-muted">{t("preview.cambios.tarjeta", { count: cuentas.length })}</span>
        <span className="ml-auto pl-2">
          <MasMenos anadidas={anadidas} quitadas={quitadas} />
        </span>
      </button>
      <ul className="border-t bd">
        {visibles.map((c) => (
          <li key={c.ruta}>
            <button
              type="button"
              onClick={() => onAbrir(c.ruta)}
              title={t("preview.cambios.abrir")}
              className="flex w-full items-center gap-1.5 px-2 py-0.5 text-left fg-faint hover:fg hover:bg-hover"
            >
              <span className="min-w-0 truncate font-mono text-[10.5px]">{c.ruta.replace(/^\//, "")}</span>
              {c.nuevo && <span className="shrink-0 text-emerald-600 dark:text-emerald-400">{t("preview.cambios.nuevo")}</span>}
              {c.borrado && <span className="shrink-0 text-red-600 dark:text-red-400">{t("preview.cambios.borrado")}</span>}
              {c.grande && <span className="shrink-0">{t("preview.cambios.grandeCorto")}</span>}
              <span className="ml-auto pl-2">
                <MasMenos anadidas={c.anadidas} quitadas={c.quitadas} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {resto > 0 && (
        <button
          type="button"
          onClick={() => setTodas((v) => !v)}
          aria-expanded={todas}
          className="w-full border-t bd px-2 py-0.5 text-left text-accent hover:underline"
        >
          {todas ? t("preview.cambios.verMenos") : t("preview.cambios.verMas", { count: resto })}
        </button>
      )}
    </div>
  );
}

const SIN_TURNOS: readonly CambiosDeUnTurno[] = [];

/** La tarjeta de UN turno, leída del almacén: el Chat sólo dice qué turno es. */
export function FicherosDelTurnoEnVivo({ projectId, turnId }: { projectId: string; turnId: string }) {
  const turnos = useSyncExternalStore(
    cambiosEnVivo.subscribe,
    () => cambiosEnVivo.turnos(projectId),
    // En el servidor no hay ningún turno: el almacén vive en la pestaña.
    () => SIN_TURNOS,
  );
  const turno = turnos.find((x) => x.turnId === turnId);
  if (!turno) return null;
  return <FicherosDelTurno ficheros={turno.ficheros} onAbrir={(ruta) => cambiosEnVivo.abrir(projectId, turnId, ruta)} />;
}
