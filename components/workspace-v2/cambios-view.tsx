"use client";

// LO QUE CAMBIÓ EN EL TURNO, fichero a fichero (plans/len-agente-2026).
//
// Es la pestaña de revisión de DeepSeek (`2026-09-15-changed-file-diff-preview.md`
// de `deepseek-harness`): una por turno, con los ficheros a elegir, la
// comparación del principio con el final del turno, los números de línea de
// los dos lados, vista unificada o lado a lado y las líneas partidas o no. Aquí
// los ficheros van a la izquierda, como en la lente «Código».
//
// EN EL MÓVIL (la #16 de plans/len-agente-2026/notas/fase-5-taller.md), el diff a
// todo el ancho y sin lista: los ficheros, en un selector en la cabecera del
// fichero, que es como lo hace DeepSeek en todos los anchos (su pestaña de
// revisión, «a file selector in its header») y como lo deja Cursor en iOS. Y
// sólo la vista unificada: lado a lado, dos columnas en 375px no se leen.
//
// CON COLORES DE SINTAXIS desde la #15 (la nota de DeepSeek del 15/09 los dejaba
// fuera; el README actual de su paquete ya los usa). Como allí, el fondo dice
// quitada o añadida, el signo lleva su color y el código, los suyos. A
// diferencia de allí, que colorea cada trozo por su cuenta, aquí se colorea el
// fichero ENTERO de antes y el de después (están en la foto), así que una línea
// dentro de un `<script>` sabe que lo está.
//
// SÓLO LECTURA, y todo como TEXTO: ni el código ni lo que escribió un
// visitante se interpretan nunca.

import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { CambiosDeUnTurno, PeticionDeCambios } from "@/lib/workspace-v2/cambios-en-vivo";
import { diffDeFichero, filasLadoALado, type LineaDelDiff, type TrozoDelDiff } from "@/lib/workspace-v2/diff-de-ficheros";
import { colorearLineas, lenguajeDe, type Trozo } from "@/lib/workspace-v2/colorear";

import { cuentasDe, MasMenos } from "./ficheros-del-turno";
import { useIsMobile } from "./use-is-mobile";
import { LineaColoreada } from "./linea-coloreada";
import { X } from "./icons";
import { IconBtn, Segmented } from "./ui";

/** Lo que se pinta como mucho de un fichero, como allí (5.000 líneas). */
const MAX_LINEAS = 5_000;

type Vista = "unificada" | "lado";

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

/** El fichero de antes y el de después, ya coloreados y partidos en líneas. */
interface Colores {
  readonly antes: readonly (readonly Trozo[])[];
  readonly despues: readonly (readonly Trozo[])[];
}

/** Los colores de una línea del diff, del lado que le toca; null si no cuadran con su texto. */
function trozosDe(l: LineaDelDiff, colores: Colores | null): readonly Trozo[] | null {
  if (!colores) return null;
  const linea = l.tipo === "anadida" ? colores.despues[(l.despues ?? 0) - 1] : colores.antes[(l.antes ?? 0) - 1];
  return linea && linea.map((t) => t.texto).join("") === l.texto ? linea : null;
}

function Texto({ texto, trozos, ajustar }: { texto: string; trozos: readonly Trozo[] | null; ajustar: boolean }) {
  return (
    <span className={`min-w-0 flex-1 pr-3 ${ajustar ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre"}`}>
      {trozos ? <LineaColoreada trozos={trozos} /> : texto || " "}
    </span>
  );
}

function Numero({ n }: { n: number | null }) {
  return <span className="w-10 shrink-0 select-none pr-2 text-right fg-faint tabular">{n ?? ""}</span>;
}

function Plegadas({ n }: { n: number }) {
  const t = useTranslations("wsChrome");
  return (
    <div className="select-none border-y bd bg-hover px-3 py-0.5 font-sans text-[10.5px] fg-faint">
      ··· {t("preview.cambios.sinCambios", { count: n })}
    </div>
  );
}

interface PropsDeLineas {
  lineas: readonly LineaDelDiff[];
  colores: Colores | null;
  ajustar: boolean;
}

function Unificada({ lineas, colores, ajustar }: PropsDeLineas) {
  return (
    <>
      {lineas.map((l, k) => (
        <div key={k} className={`flex ${FONDO[l.tipo]}`}>
          <Numero n={l.antes} />
          <Numero n={l.despues} />
          <span className={`w-4 shrink-0 select-none text-center ${COLOR_DEL_SIGNO[l.tipo]}`}>{SIGNO[l.tipo]}</span>
          <Texto texto={l.texto} trozos={trozosDe(l, colores)} ajustar={ajustar} />
        </div>
      ))}
    </>
  );
}

function LadoALado({ lineas, colores, ajustar }: PropsDeLineas) {
  const media = (l: LineaDelDiff | null, lado: "antes" | "despues") =>
    l ? (
      <div className={`flex min-w-0 ${l.tipo === "igual" ? FONDO.igual : FONDO[l.tipo]}`}>
        <Numero n={l[lado]} />
        <span className={`w-4 shrink-0 select-none text-center ${COLOR_DEL_SIGNO[l.tipo]}`}>{l.tipo === "igual" ? " " : SIGNO[l.tipo]}</span>
        <Texto texto={l.texto} trozos={trozosDe(l, colores)} ajustar={ajustar} />
      </div>
    ) : (
      <div className="bg-hover" />
    );
  return (
    <>
      {filasLadoALado(lineas).map((f, k) => (
        <div key={k} className="grid grid-cols-2">
          {media(f.izquierda, "antes")}
          <div className="grid min-w-0 border-l bd">{media(f.derecha, "despues")}</div>
        </div>
      ))}
    </>
  );
}

/** Los trozos hasta el tope de líneas; lo que pasa del tope no se pinta. */
function recortar(trozos: readonly TrozoDelDiff[]): { trozos: TrozoDelDiff[]; recortado: boolean } {
  const out: TrozoDelDiff[] = [];
  let quedan = MAX_LINEAS;
  for (const tr of trozos) {
    if (quedan <= 0) return { trozos: out, recortado: true };
    out.push(tr.lineas.length <= quedan ? tr : { ...tr, lineas: tr.lineas.slice(0, quedan) });
    quedan -= tr.lineas.length;
  }
  return { trozos: out, recortado: quedan < 0 };
}

function recorte(s: string): string {
  const una = s.replace(/\s+/g, " ").trim();
  return una.length > 70 ? `${una.slice(0, 70)}…` : una;
}

export function CambiosView({
  turnos,
  peticion,
  onClose,
}: {
  turnos: readonly CambiosDeUnTurno[];
  peticion: PeticionDeCambios | null;
  onClose: () => void;
}) {
  const t = useTranslations("wsChrome");
  const [turnId, setTurnId] = useState<string | null>(peticion?.turnId ?? null);
  const [ruta, setRuta] = useState<string | null>(peticion?.ruta ?? null);
  const [vista, setVista] = useState<Vista>("unificada");
  // Partidas por defecto, como la lente «Código» (Jesús, 02/10).
  const [ajustar, setAjustar] = useState(true);
  const estrecho = useIsMobile();

  // Una fila pulsada en la tarjeta de un turno manda: ese turno, ese fichero.
  useEffect(() => {
    if (!peticion) return;
    setTurnId(peticion.turnId);
    setRuta(peticion.ruta);
  }, [peticion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const turno = turnos.find((x) => x.turnId === turnId) ?? turnos.at(-1) ?? null;
  const cuentas = useMemo(() => (turno ? cuentasDe(turno.ficheros) : []), [turno]);
  const elegido = turno?.ficheros.find((f) => f.ruta === ruta) ?? turno?.ficheros[0] ?? null;
  const cuenta = cuentas.find((c) => c.ruta === elegido?.ruta) ?? null;
  const diff = useMemo(
    () => (elegido?.tipo === "texto" ? diffDeFichero(elegido.antes, elegido.despues) : null),
    [elegido],
  );
  const pintado = useMemo(() => (diff ? recortar(diff.trozos) : null), [diff]);
  const colores = useMemo<Colores | null>(() => {
    if (elegido?.tipo !== "texto") return null;
    const lenguaje = lenguajeDe(elegido.ruta);
    if (!lenguaje) return null;
    return { antes: colorearLineas(elegido.antes ?? "", lenguaje), despues: colorearLineas(elegido.despues ?? "", lenguaje) };
  }, [elegido]);
  const Lineas = vista === "unificada" || estrecho ? Unificada : LadoALado;
  // En el móvil no hay lista: con más de un fichero, se elige en la cabecera.
  const conSelector = estrecho && cuentas.length > 1;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-app">
      <div className="flex items-center gap-2 border-b bd px-3 py-2">
        <span className="shrink-0 text-[12px] font-medium fg ui-small">{t("preview.cambios.title")}</span>
        {turno && turnos.length > 1 ? (
          <select
            aria-label={t("preview.cambios.turno")}
            value={turno.turnId}
            onChange={(e) => {
              setTurnId(e.target.value);
              setRuta(null);
            }}
            className="min-w-0 max-w-[60%] truncate rounded-md border bd bg-app px-1.5 py-0.5 text-[11px] fg-muted ui-small"
          >
            {[...turnos].reverse().map((x) => (
              <option key={x.turnId} value={x.turnId}>
                {recorte(x.pedido)}
              </option>
            ))}
          </select>
        ) : (
          turno && <span className="min-w-0 truncate text-[11px] fg-faint ui-small">«{recorte(turno.pedido)}»</span>
        )}
        <div className="ml-auto">
          <IconBtn label={t("preview.cambios.close")} size="sm" onClick={onClose}>
            <X size={12} />
          </IconBtn>
        </div>
      </div>

      {!turno ? (
        <p className="px-3 py-6 text-center text-[12px] fg-muted ui-small">{t("preview.cambios.vacio")}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            aria-label={t("preview.cambios.files")}
            className="hidden shrink-0 overflow-auto nice-scroll border-r bd py-1 text-[12px] md:block md:w-64"
          >
            <div className="px-3 py-1 text-[10.5px] uppercase tracking-wide fg-faint ui-small">
              {t("preview.cambios.tarjeta", { count: cuentas.length })}
            </div>
            <ul>
              {cuentas.map((c) => (
                <li key={c.ruta}>
                  <button
                    type="button"
                    aria-current={c.ruta === elegido?.ruta ? "true" : undefined}
                    onClick={() => setRuta(c.ruta)}
                    className={`flex w-full items-center gap-1.5 px-3 py-0.5 text-left text-[11.5px] ${
                      c.ruta === elegido?.ruta ? "bg-hover fg" : "fg-muted hover:fg hover:bg-hover"
                    }`}
                  >
                    <span className="min-w-0 truncate font-mono">{c.ruta.replace(/^\//, "")}</span>
                    {c.nuevo && <span className="shrink-0 text-[10.5px] text-emerald-600 dark:text-emerald-400">{t("preview.cambios.nuevo")}</span>}
                    {c.borrado && <span className="shrink-0 text-[10.5px] text-red-600 dark:text-red-400">{t("preview.cambios.borrado")}</span>}
                    {c.grande && <span className="shrink-0 text-[10.5px] fg-faint">{t("preview.cambios.grandeCorto")}</span>}
                    <span className="ml-auto pl-2 text-[10.5px]">
                      <MasMenos anadidas={c.anadidas} quitadas={c.quitadas} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-h-0 min-w-0 flex-1 overflow-auto nice-scroll">
            {elegido && (
              <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-b bd bg-elev px-3 py-1.5">
                {/* En el móvil no hay lista: el fichero se elige aquí. */}
                {conSelector ? (
                  <select
                    aria-label={t("preview.cambios.files")}
                    value={elegido.ruta}
                    onChange={(e) => setRuta(e.target.value)}
                    className="min-w-0 max-w-full truncate rounded-md border bd bg-app px-1.5 py-0.5 font-mono text-[11px] fg"
                  >
                    {cuentas.map((c) => (
                      <option key={c.ruta} value={c.ruta}>
                        {/* Lo mismo que dice la fila de la lista del escritorio. */}
                        {[
                          c.ruta.replace(/^\//, ""),
                          c.nuevo ? t("preview.cambios.nuevo") : null,
                          c.borrado ? t("preview.cambios.borrado") : null,
                          c.grande ? t("preview.cambios.grandeCorto") : null,
                          c.anadidas !== null && c.quitadas !== null ? `+${c.anadidas} −${c.quitadas}` : null,
                        ]
                          .filter(Boolean)
                          .join("  ")}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="min-w-0 truncate font-mono text-[11px] font-medium fg-muted">{elegido.ruta.replace(/^\//, "")}</span>
                )}
                {!conSelector && cuenta?.nuevo && <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400 ui-small">{t("preview.cambios.nuevo")}</span>}
                {!conSelector && cuenta?.borrado && <span className="text-[10.5px] text-red-600 dark:text-red-400 ui-small">{t("preview.cambios.borrado")}</span>}
                {/* Con el selector, las marcas y las cuentas ya van en él. */}
                {!conSelector && (
                  <span className="text-[10.5px] ui-small">
                    <MasMenos anadidas={cuenta?.anadidas ?? null} quitadas={cuenta?.quitadas ?? null} />
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  {!estrecho && (
                    <Segmented<Vista>
                      size="xs"
                      value={vista}
                      onChange={setVista}
                      options={[
                        { value: "unificada", label: t("preview.cambios.unificada") },
                        { value: "lado", label: t("preview.cambios.ladoALado") },
                      ]}
                    />
                  )}
                  <button
                    type="button"
                    aria-pressed={ajustar}
                    onClick={() => setAjustar((v) => !v)}
                    className={`rounded-md border bd px-1.5 py-0.5 text-[10px] font-medium ui-small ${ajustar ? "seg-active" : "fg-muted hover:fg"}`}
                  >
                    {t("preview.cambios.ajustar")}
                  </button>
                </div>
              </header>
            )}
            {elegido?.tipo === "grande" ? (
              <p className="p-3 text-[12px] fg-muted ui-small">{t("preview.cambios.grande")}</p>
            ) : (
              diff &&
              pintado && (
                <div className={`py-1 font-mono text-[11.5px] leading-[1.55] ${ajustar ? "" : "w-max min-w-full"}`}>
                  {pintado.trozos.map((tr, i) => (
                    <Fragment key={i}>
                      {tr.saltadas > 0 && <Plegadas n={tr.saltadas} />}
                      <Lineas lineas={tr.lineas} colores={colores} ajustar={ajustar} />
                    </Fragment>
                  ))}
                  {!pintado.recortado && diff.saltadasAlFinal > 0 && <Plegadas n={diff.saltadasAlFinal} />}
                  {pintado.recortado && (
                    <p className="px-3 py-2 font-sans text-[11px] fg-faint ui-small">
                      {t("preview.cambios.recortado", { n: MAX_LINEAS })}
                    </p>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
