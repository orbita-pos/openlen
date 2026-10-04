"use client";

// LEN TE ACOMPAÑA (04/10). Cuando la cara del héroe sale de pantalla, Len baja
// contigo: fijo en la esquina, cambia de cara según lo que estás mirando
// (escribe en la maqueta del taller, busca entre las plantillas, piensa en los
// precios) y se duerme si te quedas quieto. Tocarlo te sube a la caja para
// pedirle algo.
//
// Las secciones se marcan con `data-len-section="<nombre>"`; mientras algo con
// `data-len-hide` está en pantalla (la cara del héroe, la tarjeta del cierre,
// que trae su propia cara), se esconde: nunca hay dos Len a la vez.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CaraDeLen, type EstadoDeLaCara } from "@/components/llamada/cara-de-len";
import { cn } from "@/lib/cn";

const SECTION_STATE: Record<string, EstadoDeLaCara> = {
  taller: "escribiendo",
  plantillas: "buscando",
  resultados: "mirando",
  confianza: "revisando",
  precios: "pensando",
};

const IDLE_MS = 20_000;
const WAVE_MS = 2400;
const BUBBLE_MS = 4500;

export function LenCompanion() {
  const t = useTranslations("marketing.lenCompanion");
  const [hidden, setHidden] = useState(true);
  const [section, setSection] = useState<string | null>(null);
  const [asleep, setAsleep] = useState(false);
  const [waving, setWaving] = useState(false);
  const [bubble, setBubble] = useState(false);
  const [hover, setHover] = useState(false);
  const greeted = useRef(false);
  const timers = useRef<number[]>([]);

  // Escondido mientras se vea la cara del héroe o la del cierre.
  useEffect(() => {
    const visible = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        setHidden(visible.size > 0);
      },
      { threshold: 0.15 },
    );
    document.querySelectorAll("[data-len-hide]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // La sección que cruza la línea media de la pantalla.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setSection((e.target as HTMLElement).dataset.lenSection ?? null);
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    document.querySelectorAll("[data-len-section]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Se duerme si nadie se mueve; cualquier gesto lo despierta.
  useEffect(() => {
    let timer = window.setTimeout(() => setAsleep(true), IDLE_MS);
    const wake = () => {
      setAsleep(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAsleep(true), IDLE_MS);
    };
    const events = ["scroll", "pointermove", "keydown", "touchstart"] as const;
    for (const ev of events) window.addEventListener(ev, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, wake);
    };
  }, []);

  // La primera vez que aparece, saluda y dice algo.
  useEffect(() => {
    if (hidden || greeted.current) return;
    greeted.current = true;
    setWaving(true);
    setBubble(true);
    timers.current.push(
      window.setTimeout(() => setWaving(false), WAVE_MS),
      window.setTimeout(() => setBubble(false), BUBBLE_MS),
    );
  }, [hidden]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const state: EstadoDeLaCara = asleep
    ? "dormido"
    : waving
      ? "saludando"
      : (section && SECTION_STATE[section]) || "reposo";

  const ask = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => document.getElementById("hero-prompt")?.focus({ preventScroll: true }), 650);
  };

  const showBubble = !hidden && (bubble || hover);

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-40 flex items-end gap-2 transition-all duration-500 ease-out sm:bottom-6 sm:right-6",
        hidden ? "pointer-events-none translate-y-6 scale-90 opacity-0" : "translate-y-0 scale-100 opacity-100",
      )}
    >
      <span
        className={cn(
          "mb-4 hidden rounded-2xl rounded-br-md bg-white px-3.5 py-2 text-[13.5px] text-zinc-800 shadow-lg shadow-zinc-900/10 ring-1 ring-zinc-200 transition-all duration-300 sm:block dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10",
          showBubble ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-2 opacity-0",
        )}
      >
        {t("ask")}
      </span>
      <button
        type="button"
        onClick={ask}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-label={t("aria")}
        tabIndex={hidden ? -1 : 0}
        className="size-16 rounded-full drop-shadow-[0_10px_18px_rgba(255,90,54,0.35)] transition-transform duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-coral-500 sm:size-[76px]"
      >
        <CaraDeLen estado={state} props="compact" className="size-full" />
      </button>
    </div>
  );
}
