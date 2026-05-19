import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Home } from "lucide-react";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";

export const metadata: Metadata = {
  title: "Página no encontrada",
  description: "La URL no corresponde a ninguna página de OpenLen.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950">
      <MarketingChrome>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 grid-bg opacity-40" aria-hidden />
          <div className="relative mx-auto max-w-2xl px-6 py-24 sm:py-32 text-center">
            <div className="inline-flex items-center gap-2 rounded-full ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white/70 dark:bg-zinc-950/70 backdrop-blur px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-coral-500 opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-coral-500" />
              </span>
              Error 404
            </div>

            <h1 className="mt-6 text-5xl sm:text-7xl font-semibold tracking-tightest leading-[0.95]">
              Esta página{" "}
              <span className="bg-gradient-to-br from-coral-500 to-coral-700 bg-clip-text text-transparent">
                no existe.
              </span>
            </h1>

            <p className="mt-5 text-base sm:text-lg text-zinc-600 dark:text-zinc-400 max-w-md mx-auto">
              La URL no corresponde a ningún template ni proyecto. Volvé al
              inicio o pickeá uno de los 15 templates curados.
            </p>

            <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/"
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-coral-700 hover:bg-coral-800 active:bg-coral-900 btn-coral-shadow text-white px-5 py-2.5 text-sm font-medium transition"
              >
                <Home size={14} />
                Volver al inicio
              </Link>
              <Link
                href="/templates"
                className="inline-flex items-center justify-center gap-1.5 rounded-full ring-1 ring-zinc-300 dark:ring-zinc-700 hover:ring-zinc-900 dark:hover:ring-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 transition"
              >
                Ver templates
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </section>
      </MarketingChrome>
    </div>
  );
}
