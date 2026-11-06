"use client";

// LA PÍLDORA PÁGINA/APP DEL INPUT DE LA PORTADA (Jesús, 12/10: «un select
// bonito en el input»): una píldora que dice lo elegido y un menú hacia arriba
// con la piel del `+`, con los textos y los dibujos en miniatura de
// `tarjetas-nace-como.tsx`. Lo elegido viaja a /new en la URL (`newProjectHref`).
//
// THE SAME PILL IN THE /new COMPOSER (Jesús, 06/11: «que el input tenga un
// select como lo tiene la page /, porque así como lo tenemos con un grid baja
// el input y se ve feo»): the four cards above it are gone; there it wears the
// workspace's tokens (`piel="taller"`) and also offers Herramienta.
//
// El menú se ancla al primer antepasado con `position: relative` —en la
// portada, la barra del input—, no a la píldora: anclado a ella se salía por la
// derecha en un móvil.

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Gamepad2, LayoutDashboard, PanelsTopLeft, Wrench } from "lucide-react";
import { useMandoDesplegable } from "@/components/workspace-v2/use-mando-desplegable";
import {
  DibujoApp,
  DibujoHerramienta,
  DibujoJuego,
  DibujoPagina,
  type NaceComo,
} from "@/components/workspace-v2/tarjetas-nace-como";
import { cn } from "@/lib/cn";

/** Two skins: the home page's (zinc and coral, like the rest of the marketing site) and the workspace's (its
 *  tokens, like the `+` beside it in the /new composer). Same pill, same menu, same behaviour. */
const PIELES = {
  portada: {
    /** The home page's input sits low on the page: the menu opens upwards. */
    hacia: "bottom-[calc(100%+8px)]",
    pill: "hover:bg-zinc-100 dark:hover:bg-zinc-900",
    pillElegida: "text-coral-600 dark:text-coral-400",
    pillNeutra: "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100",
    pillAbierta: "bg-zinc-100 dark:bg-zinc-900",
    menu: "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950",
    rotulo: "text-zinc-500 dark:text-zinc-400",
    opcion: "hover:bg-zinc-100 dark:hover:bg-zinc-900",
    dibujo: "bg-zinc-50 dark:bg-zinc-900",
    dibujoElegido: "border-coral-500/40 text-coral-500",
    dibujoNeutro: "border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-500",
    titulo: "text-zinc-900 dark:text-zinc-100",
    linea: "text-zinc-500 dark:text-zinc-400",
    marca: "text-coral-600 dark:text-coral-400",
  },
  taller: {
    /** The /new composer sits near the top, under the header: upwards hid Página and App behind it (06/11). */
    hacia: "top-[calc(100%+8px)]",
    pill: "hover:bg-side",
    pillElegida: "text-[var(--nc-accent-text)]",
    pillNeutra: "fg-muted hover:fg",
    pillAbierta: "bg-side",
    menu: "bd-strong bg-elev",
    rotulo: "fg-faint",
    opcion: "hover:bg-side",
    dibujo: "bg-app",
    dibujoElegido: "border-[color:var(--accent)] text-[color:var(--accent)]",
    dibujoNeutro: "bd fg-faint",
    titulo: "fg",
    linea: "fg-muted",
    marca: "text-[var(--nc-accent-text)]",
  },
} as const;

export function HeroKindPicker({
  value,
  onChange,
  conJuego = false,
  conHerramienta = false,
  herramientaBloqueada,
  disabled = false,
  piel = "portada",
}: {
  value: NaceComo;
  onChange: (v: NaceComo) => void;
  /** Games are on (spec local 2026-11-05-modo-juego-design, §8.2): Juego is offered too, as Kimi offers 3D Make
   *  from its home page. */
  conJuego?: boolean;
  /** Tools are on (spec local 2026-11-04-herramientas-hechas-por-len, §4.9 door 2): Herramienta is offered last. */
  conHerramienta?: boolean;
  /** Why Herramienta can't be chosen (the Free plan): its line says so and it can't be picked. */
  herramientaBloqueada?: string;
  /** While the first message is being sent: the pill doesn't open. */
  disabled?: boolean;
  piel?: keyof typeof PIELES;
}) {
  const t = useTranslations("wsChrome");
  const [open, setOpen] = useState(false);
  const mando = useMandoDesplegable({ abierto: open, cerrar: () => setOpen(false) });
  const s = PIELES[piel];
  const opciones: ReadonlyArray<{ id: NaceComo; titulo: string; linea: string; dibujo: ReactNode; bloqueada?: boolean }> = [
    { id: "pagina", titulo: t("start.kind.page"), linea: t("start.kind.pageHint"), dibujo: <DibujoPagina /> },
    { id: "app", titulo: t("start.kind.app"), linea: t("start.kind.appHint"), dibujo: <DibujoApp /> },
    ...(conJuego ? [{ id: "game" as const, titulo: t("start.kind.game"), linea: t("start.kind.gameHint"), dibujo: <DibujoJuego /> }] : []),
    ...(conHerramienta
      ? [{ id: "tool" as const, titulo: t("start.kind.tool"), linea: herramientaBloqueada ?? t("start.kind.toolHint"), dibujo: <DibujoHerramienta />, bloqueada: Boolean(herramientaBloqueada) }]
      : []),
  ];
  const Icono = value === "app" ? LayoutDashboard : value === "game" ? Gamepad2 : value === "tool" ? Wrench : PanelsTopLeft;
  const nombre =
    value === "app" ? t("start.kind.app") : value === "game" ? t("start.kind.game") : value === "tool" ? t("start.kind.tool") : t("start.kind.page");

  const elegir = (id: NaceComo) => {
    setOpen(false);
    onChange(id);
    mando.refDisparador.current?.focus();
  };

  return (
    <div ref={mando.refContenedor} onKeyDown={mando.alPulsarTecla}>
      <button
        type="button"
        ref={mando.refDisparador}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("start.kind.label")} ${nombre}`}
        title={t("start.kind.label")}
        disabled={disabled}
        onClick={() => setOpen((x) => !x)}
        className={cn(
          "inline-flex h-[30px] items-center gap-1.5 rounded-[9px] pl-2 pr-1.5 text-[12.5px] font-medium transition disabled:opacity-40",
          s.pill,
          value === "pagina" ? s.pillNeutra : s.pillElegida,
          open && s.pillAbierta,
        )}
      >
        <Icono size={14} aria-hidden />
        <span>{nombre}</span>
        <ChevronDown
          size={13}
          aria-hidden
          className={cn("opacity-60 transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("start.kind.label")}
          className={cn(
            "nc-card-in absolute left-0 z-20 w-[310px] max-w-full rounded-[14px] border p-1.5 shadow-[0_18px_40px_-12px_rgb(20_10_5/0.35)]",
            s.hacia,
            s.menu,
          )}
        >
          <p className={cn("px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.14em]", s.rotulo)}>
            {t("start.kind.label")}
          </p>
          {opciones.map((o) => {
            const elegida = value === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={elegida}
                disabled={o.bloqueada}
                onClick={() => elegir(o.id)}
                className={cn(
                  "nc-up flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
                  s.opcion,
                )}
              >
                <span
                  className={cn(
                    "w-[58px] shrink-0 overflow-hidden rounded-[7px] border transition",
                    s.dibujo,
                    elegida ? s.dibujoElegido : s.dibujoNeutro,
                  )}
                >
                  {o.dibujo}
                </span>
                <span className="min-w-0 flex-1">
                  <b className={cn("block text-[13px] font-semibold", s.titulo)}>{o.titulo}</b>
                  <small className={cn("block text-[11.5px] leading-snug", s.linea)}>{o.linea}</small>
                </span>
                <span className="grid w-[16px] shrink-0 place-items-center">
                  {elegida && <Check size={15} className={s.marca} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
