"use client";

// LA PÍLDORA PÁGINA/APP DEL INPUT DE LA PORTADA (Jesús, 12/10: «un select
// bonito en el input»). Es la misma elección que las dos tarjetas del estado
// vacío de /new (`tarjetas-nace-como.tsx`), con sus textos y sus dibujos en
// miniatura, pero cabe en la barra del input: una píldora que dice lo elegido
// y un menú hacia arriba con la piel del `+`. Lo elegido viaja a /new en la URL
// (`newProjectHref`) y allí marca la tarjeta.
//
// El menú se ancla al primer antepasado con `position: relative` —en la
// portada, la barra del input—, no a la píldora: anclado a ella se salía por la
// derecha en un móvil.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, LayoutDashboard, PanelsTopLeft } from "lucide-react";
import { useMandoDesplegable } from "@/components/workspace-v2/use-mando-desplegable";
import {
  DibujoApp,
  DibujoPagina,
  type NaceComo,
} from "@/components/workspace-v2/tarjetas-nace-como";
import { cn } from "@/lib/cn";

export function HeroKindPicker({
  value,
  onChange,
}: {
  value: NaceComo;
  onChange: (v: NaceComo) => void;
}) {
  const t = useTranslations("wsChrome");
  const [open, setOpen] = useState(false);
  const mando = useMandoDesplegable({ abierto: open, cerrar: () => setOpen(false) });
  const opciones = [
    { id: "pagina", titulo: t("start.kind.page"), linea: t("start.kind.pageHint"), dibujo: <DibujoPagina /> },
    { id: "app", titulo: t("start.kind.app"), linea: t("start.kind.appHint"), dibujo: <DibujoApp /> },
  ] as const;
  const Icono = value === "app" ? LayoutDashboard : PanelsTopLeft;

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
        aria-label={`${t("start.kind.label")} ${value === "app" ? t("start.kind.app") : t("start.kind.page")}`}
        title={t("start.kind.label")}
        onClick={() => setOpen((x) => !x)}
        className={cn(
          "inline-flex h-[30px] items-center gap-1.5 rounded-[9px] pl-2 pr-1.5 text-[12.5px] font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-900",
          value === "app"
            ? "text-coral-600 dark:text-coral-400"
            : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100",
          open && "bg-zinc-100 dark:bg-zinc-900",
        )}
      >
        <Icono size={14} aria-hidden />
        <span>{value === "app" ? t("start.kind.app") : t("start.kind.page")}</span>
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
          className="nc-card-in absolute bottom-[calc(100%+8px)] left-0 z-20 w-[310px] max-w-full rounded-[14px] border border-zinc-300 bg-white p-1.5 shadow-[0_18px_40px_-12px_rgb(20_10_5/0.35)] dark:border-zinc-700 dark:bg-zinc-950"
        >
          <p className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
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
                onClick={() => elegir(o.id)}
                className="nc-up flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <span
                  className={cn(
                    "w-[58px] shrink-0 overflow-hidden rounded-[7px] border bg-zinc-50 transition dark:bg-zinc-900",
                    elegida
                      ? "border-coral-500/40 text-coral-500"
                      : "border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-500",
                  )}
                >
                  {o.dibujo}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">{o.titulo}</b>
                  <small className="block text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">
                    {o.linea}
                  </small>
                </span>
                <span className="grid w-[16px] shrink-0 place-items-center">
                  {elegida && <Check size={15} className="text-coral-600 dark:text-coral-400" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
