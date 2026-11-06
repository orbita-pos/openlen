"use client";

// LA PÍLDORA PÁGINA/APP DEL INPUT DE LA PORTADA (Jesús, 12/10: «un select
// bonito en el input»): una píldora que dice lo elegido y un menú hacia arriba
// con la piel del `+`, con los textos y los dibujos en miniatura de
// `tarjetas-nace-como.tsx`. Lo elegido viaja a /new en la URL (`newProjectHref`).
//
// It offers Herramienta too (06/11), and lives in the only box, the home's
// (Jesús, 06/11: «¿para qué tener 2 inputs?»): /new's box, with its own skin of
// this pill in the workspace's tokens, went away that day.
//
// El menú se ancla al primer antepasado con `position: relative` —en la
// portada, la barra del input—, no a la píldora: anclado a ella se salía por la
// derecha en un móvil.
//
// IT OPENS WHERE IT FITS (Jesús, 06/11: «en el select no se ve todo, se
// esconde»): each skin has the side it prefers, but once /new lost its top bar
// the box sat mid-screen and the four options ran off the bottom. Opening, it
// measures the room above and below its anchor and flips when its side is short.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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

/** The menu's gap from its anchor (the `8px` of the two sides below). */
const HUECO = 8;
const HACIA = { arriba: "bottom-[calc(100%+8px)]", abajo: "top-[calc(100%+8px)]" } as const;
type Lado = keyof typeof HACIA;

/** Which side the menu opens to: the preferred one when it fits, else the other when IT fits, else the roomier. */
export function ladoQueCabe(preferido: Lado, alto: number, arriba: number, abajo: number): Lado {
  const cabe = (lado: Lado) => (lado === "arriba" ? arriba : abajo) >= alto;
  const otro: Lado = preferido === "arriba" ? "abajo" : "arriba";
  if (cabe(preferido)) return preferido;
  if (cabe(otro)) return otro;
  return arriba > abajo ? "arriba" : "abajo";
}

/** The pill's look: the home's zinc and coral, like the `+` beside it. */
const PIEL = {
  /** The home page's input sits low on the page: the menu prefers upwards. */
  lado: "arriba" as Lado,
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
} as const;

export function HeroKindPicker({
  value,
  onChange,
  conJuego = false,
  conHerramienta = false,
  herramientaBloqueada,
  disabled = false,
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
}) {
  const t = useTranslations("wsChrome");
  const [open, setOpen] = useState(false);
  const mando = useMandoDesplegable({ abierto: open, cerrar: () => setOpen(false) });
  const s = PIEL;
  const refMenu = useRef<HTMLDivElement>(null);
  const [lado, setLado] = useState<Lado>(s.lado);
  // In a window too short for it on either side, it scrolls inside the room it has instead of running off.
  const [tope, setTope] = useState<number | null>(null);
  // Before it paints: measured against the window, from the anchor the menu hangs off (its `offsetParent`).
  useLayoutEffect(() => {
    if (!open) return;
    const menu = refMenu.current;
    const ancla = menu?.offsetParent?.getBoundingClientRect();
    if (!menu || !ancla) return;
    const arriba = ancla.top - HUECO;
    const abajo = window.innerHeight - ancla.bottom - HUECO;
    const elegido = ladoQueCabe(s.lado, menu.scrollHeight || menu.offsetHeight, arriba, abajo);
    const sitio = elegido === "arriba" ? arriba : abajo;
    setLado(elegido);
    setTope((menu.scrollHeight || menu.offsetHeight) > sitio ? Math.max(sitio, 0) : null);
  }, [open, s.lado]);
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
          ref={refMenu}
          role="menu"
          aria-label={t("start.kind.label")}
          data-lado={lado}
          style={tope === null ? undefined : { maxHeight: tope }}
          className={cn(
            // `kind-menu-scroll` (tokens.css): when a short window makes it scroll, a quiet thin thumb, not the
            // browser's generic bar with its arrows (Jesús, 06/11).
            "kind-menu-scroll nc-card-in absolute left-0 z-20 w-[310px] max-w-full overflow-y-auto overscroll-contain rounded-[14px] border p-1.5 shadow-[0_18px_40px_-12px_rgb(20_10_5/0.35)]",
            HACIA[lado],
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
