"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowRight, Menu, Moon, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/cn";
import { OpenLenMark } from "@/components/openlen-logo";
import { LocaleSwitcher } from "@/components/locale-switcher";

const links = [
  { labelKey: "nav.links.templates", href: "/templates" },
  { labelKey: "nav.links.features", href: "/#features" },
  { labelKey: "nav.links.pricing", href: "/#pricing" },
  { labelKey: "nav.links.docs", href: "/docs" },
] as const;

export interface NavProps {
  dark: boolean;
  onToggleDark: () => void;
}

export function Nav({ dark, onToggleDark }: NavProps) {
  const t = useTranslations("marketing");
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    // BARRA A TODO LO ANCHO, A LO GROK BOT (09/10). Antes era una pastilla de
    // cristal flotando en el centro; ahora es la fila de la referencia: marca
    // y enlaces a la izquierda, y a la derecha dos píldoras — la secundaria
    // («Iniciar sesión», como su «Contact Sales») y la principal en contraste
    // máximo («Pruébalo gratis», como su «Download»). Transparente arriba del
    // todo para que la malla del héroe pase por debajo; al bajar, cristal.
    //
    // Sigue midiendo 56px (h-14) y sigue en el flujo: el héroe sube esos 56
    // con `-mt-14 pt-14`, y el resto de páginas con MarketingChrome cuentan
    // con ese hueco arriba.
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b transition-colors duration-300",
        scrolled || menuOpen
          ? "border-zinc-900/[0.06] bg-white/80 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#0a0a0a]/80"
          : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-14 max-w-[88rem] items-center gap-2 px-4 sm:px-6">
        <Link
          href="/"
          onClick={() => setMenuOpen(false)}
          className="flex items-center gap-2 group mr-4 lg:mr-8"
        >
          <OpenLenMark className="h-6 w-6 shrink-0" />
          <span className="font-semibold tracking-tight text-[15px]">
            Open<span className="text-coral-700 dark:text-coral-400">Len</span>
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1 text-sm">
          {links.map((l) => (
            <Link
              key={l.labelKey}
              href={l.href}
              className="px-3 py-1.5 rounded-full text-[14.5px] font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-900/[0.04] dark:text-zinc-200 dark:hover:text-white dark:hover:bg-white/[0.06] transition-colors"
            >
              {t(l.labelKey)}
            </Link>
          ))}
          <a
            href="https://github.com/orbita-pos/openlen"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14.5px] font-medium text-zinc-700 hover:text-zinc-950 hover:bg-zinc-900/[0.04] dark:text-zinc-200 dark:hover:text-white dark:hover:bg-white/[0.06] transition-colors"
          >
            <GithubIcon size={14} />
            <span>GitHub</span>
          </a>
        </nav>

        <div className="flex-1" aria-hidden />

        <div className="flex items-center gap-1">
          <LocaleSwitcher />
          <button
            type="button"
            onClick={onToggleDark}
            aria-label={t("nav.toggleDark")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 hover:text-zinc-900 hover:bg-zinc-900/[0.04] dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link
            href="/login"
            className="ml-1 hidden sm:inline-flex items-center h-10 px-4 rounded-full text-[14.5px] font-medium bg-zinc-900/[0.06] text-zinc-800 hover:bg-zinc-900/[0.1] dark:bg-white/10 dark:text-zinc-100 dark:hover:bg-white/[0.15] transition-colors"
          >
            {t("nav.signIn")}
          </Link>
          <Link
            href="/register"
            className="hidden sm:inline-flex items-center gap-1.5 h-10 px-4 rounded-full text-[14.5px] font-medium bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
          >
            {t("nav.tryFree")} <ArrowRight size={14} />
          </Link>
          {/* Mobile menu toggle — the desktop nav and (on the smallest screens)
              the auth CTAs are hidden, so without this a phone visitor can't
              reach the links or sign up.

              EL CORTE ES `lg`, NO `md` — y esto era un fallo medible, no una
              preferencia. Medido el 2026-09-02 a 889px de ancho: la pastilla
              pedia 919px de contenido en una caja de 863, y los 56 que sobraban
              salian por la DERECHA, que es justo donde vive «Prueba gratis». El
              CTA principal de la portada quedaba cortado, y con el la portada
              entera ganaba barra de scroll horizontal.
              La cuenta no da: logo 95 + enlaces 454 + grupo derecho 323 pasan
              de 870 antes de los huecos, asi que la fila completa no cabe hasta
              ~940px — pero se encendia en 768. Entre esos dos anchos el diseno
              nunca cupo. Subir el corte a `lg` (1024) deja el hamburguesa a
              cargo de esa franja, y el panel de abajo ya lleva TODO lo que se
              esconde: los enlaces, GitHub, entrar y el CTA. */}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={t("nav.menu")}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-panel"
            className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 hover:text-zinc-900 hover:bg-zinc-900/[0.04] dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-nav-panel"
          className="lg:hidden mx-auto w-full max-w-[88rem] border-t border-zinc-900/[0.06] dark:border-white/[0.06] px-4 pt-2 pb-4 flex flex-col gap-0.5"
        >
          {links.map((l) => (
            <Link
              key={l.labelKey}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2.5 rounded-xl text-[15px] text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            >
              {t(l.labelKey)}
            </Link>
          ))}
          <a
            href="https://github.com/orbita-pos/openlen"
            target="_blank"
            rel="noreferrer"
            onClick={() => setMenuOpen(false)}
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-[15px] text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            <GithubIcon size={16} />
            <span>GitHub</span>
          </a>
          <div className="my-1.5 h-px bg-zinc-200/80 dark:bg-zinc-800/80" />
          <Link
            href="/login"
            onClick={() => setMenuOpen(false)}
            className="px-3 py-2.5 rounded-xl text-[15px] font-medium text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            {t("nav.signIn")}
          </Link>
          <Link
            href="/register"
            onClick={() => setMenuOpen(false)}
            className="mt-1"
          >
            <Button size="sm" className="w-full rounded-full">
              {t("nav.tryFree")} <ArrowRight size={14} />
            </Button>
          </Link>
        </nav>
      )}
    </header>
  );
}
