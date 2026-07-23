import type { CSSProperties } from "react";
import {
  Sparkles,
  ChevronDown,
  Globe,
  Moon,
  Coins,
  ListTree,
  MessageSquare,
  Image as ImageIcon,
  Layers,
  History,
  House,
  Package,
  BarChart3,
  Inbox,
  Megaphone,
  Store,
  Monitor,
  Tablet,
  Smartphone,
  Pencil,
  RefreshCw,
  ExternalLink,
  ArrowUp,
  Crosshair,
} from "lucide-react";

// Hero product visual — a faithful, STATIC replica of the real OpenLen /new
// editor (the Len workspace): TopBar · icon rail · Chat (Len) panel · preview
// canvas · right inspector. Rebuilt 1:1 from the real workspace-v2 components.
// Tokens come from the `.hero-product` class in app/globals.css (same palette
// as app/[locale]/new/tokens.css) — light by default, dark under an ancestor
// `.dark`, so the mock tracks the marketing site's theme. The CENTER canvas
// shows a real finished landing page (a static screenshot built by Len).

function orb(color: string): CSSProperties {
  return {
    background: `radial-gradient(circle at 34% 26%, rgba(255,255,255,0.55), rgba(255,255,255,0) 45%), radial-gradient(circle at 60% 70%, ${color}, color-mix(in oklch, ${color}, black 35%))`,
    boxShadow:
      "inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -4px 8px rgba(0,0,0,0.35)",
  };
}

// Mirrors the REAL unified rail (rail-model.ts): Crear | divider | Operar.
const RAIL_CREAR_MOCK = [
  { Icon: House, on: false }, // Página
  { Icon: ListTree, on: false }, // Sitio
  { Icon: MessageSquare, on: true }, // Chat (Len) — active
  { Icon: ImageIcon, on: false }, // Imágenes
  { Icon: Layers, on: false }, // Library
  { Icon: Sparkles, on: false }, // 3D
];
const RAIL_OPERAR_MOCK = [
  { Icon: Package, on: false }, // Módulos
  { Icon: BarChart3, on: false }, // Resultados
  { Icon: Inbox, on: false }, // Bandeja
  { Icon: Megaphone, on: false }, // Marketing
  { Icon: Store, on: false }, // Mi negocio
  { Icon: History, on: false }, // Versiones
];

export function HeroProduct() {
  return (
    <div className="relative w-full">
      <div
        className="absolute -inset-x-8 -top-8 bottom-0 -z-10 rounded-[40px] blur-3xl opacity-50 bg-[radial-gradient(55%_45%_at_50%_25%,rgba(255,90,54,0.18),transparent_70%)]"
        aria-hidden
      />

      <div
        className="hero-product overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-[var(--bg)] text-[var(--fg)] shadow-[0_40px_120px_-50px_rgba(0,0,0,0.28)] dark:shadow-[0_50px_140px_-50px_rgba(0,0,0,0.6)] [font-family:Inter,system-ui,sans-serif]"
      >
        {/* ── TOP BAR ── */}
        <div className="flex items-center justify-between gap-3 h-[52px] px-3 sm:px-4 border-b border-[var(--border)] bg-[var(--bg)]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-gradient-to-br from-[#FF7E55] to-[#C72E10]">
                <span className="h-3 w-3 rounded-full bg-white/90" />
              </span>
              <span className="hidden md:inline text-[15px] font-semibold tracking-tight">
                Open<span className="text-[var(--accent-strong)] dark:text-[#FF8463]">Len</span>
              </span>
            </span>
            <span className="hidden md:block h-5 w-px bg-[var(--border)]" />
            <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md">
              <span className="text-[13px] text-[var(--fg-muted)] hidden sm:inline">
                Margot Rey · Estudio
              </span>
              <ChevronDown size={12} className="text-[var(--fg-faint)]" />
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="font-mono text-[var(--fg-muted)]">Guardado</span>
            </span>
          </div>

          <div className="flex items-center gap-1">
            <span className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-md bg-[var(--accent-strong)] text-white text-[12px] font-medium shadow-[0_1px_2px_0_rgba(255,90,54,0.35),0_8px_24px_-6px_rgba(255,90,54,0.5)]">
              <Sparkles size={12} />
              <span className="hidden sm:inline">Deploy</span>
              <ChevronDown size={11} />
            </span>
            <span className="hidden md:inline-block h-5 w-px bg-[var(--border)] mx-1.5" />
            <span className="hidden lg:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium ring-1 ring-inset ring-[var(--border)] text-[var(--fg-muted)] tabular-nums">
              <Coins size={13} className="text-[var(--accent-strong)] dark:text-[#FF8463]" /> 920
            </span>
            <span className="hidden lg:inline-flex items-center gap-1.5 px-2 py-1.5 text-[13px] font-medium text-[var(--fg-muted)]">
              <Globe size={14} /> ES <ChevronDown size={13} />
            </span>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-muted)]">
              <Moon size={14} />
            </span>
            <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white text-[11.5px] font-semibold ring-1 ring-white/30">
              J
              <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-[var(--bg)]" />
            </span>
          </div>
        </div>

        {/* ── BODY: rail · chat (Len) · preview · inspector ── */}
        <div className="flex h-[520px] sm:h-[600px]">
          {/* icon rail */}
          <div className="hidden sm:flex h-full w-12 shrink-0 flex-col items-center pt-2 gap-1 border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white text-[11px] font-semibold">
              M
            </span>
            {RAIL_CREAR_MOCK.map(({ Icon, on }, i) => (
              <span
                key={`c${i}`}
                className={`grid h-8 w-8 place-items-center rounded-md ${
                  on
                    ? "bg-[var(--bg-elev)] text-[var(--fg)] border border-[var(--border)] shadow-[0_1px_2px_0_rgba(0,0,0,0.3)]"
                    : "text-[var(--fg-muted)]"
                }`}
              >
                <Icon size={14} />
              </span>
            ))}
            <span className="my-1 h-px w-6 bg-black/10 dark:bg-white/10" />
            {RAIL_OPERAR_MOCK.map(({ Icon, on }, i) => (
              <span
                key={`o${i}`}
                className={`grid h-8 w-8 place-items-center rounded-md ${
                  on
                    ? "bg-[var(--bg-elev)] text-[var(--fg)] border border-[var(--border)] shadow-[0_1px_2px_0_rgba(0,0,0,0.3)]"
                    : "text-[var(--fg-muted)]"
                }`}
              >
                <Icon size={14} />
              </span>
            ))}
          </div>

          {/* Chat (Len) panel */}
          <div className="hidden lg:flex h-full w-[272px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)]">
              <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--fg-faint)] font-semibold">
                Chat
              </span>
            </div>
            <div className="flex-1 min-h-0 px-3 py-3 space-y-3 overflow-hidden">
              <div className="flex gap-2 flex-row-reverse">
                <span className="shrink-0 grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white">
                  J
                </span>
                <div className="min-w-0 max-w-[80%] text-right">
                  <div className="inline-block rounded-2xl px-3 py-2 text-left bg-[var(--accent-soft)] border border-[color:#FF5A36]/30 text-[12.5px] leading-relaxed text-[#B23A1A] dark:text-[#FFB39E]">
                    Hazlo minimal y editorial, con una galería de proyectos
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <span className="shrink-0 grid h-6 w-6 place-items-center rounded-full bg-[var(--accent-strong)] text-white">
                  <Sparkles size={11} />
                </span>
                <div className="min-w-0 max-w-[85%]">
                  <div className="inline-block rounded-2xl px-3 py-2 text-left bg-[var(--bg-elev)] border border-[var(--border)] text-[12.5px] leading-relaxed text-[var(--fg)]">
                    Listo — titulares editoriales, galería blanca con mucho aire
                    y 9 fotos en el hero.
                  </div>
                  <div className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] px-1.5 py-0.5 text-[10.5px] text-[var(--fg-faint)]">
                    <Sparkles size={9} className="text-[var(--accent-strong)] dark:text-[#FF8463]" /> Aplicado ·
                    hace 4s
                  </div>
                </div>
              </div>
            </div>
            <div className="p-3 pt-0">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)]">
                <div className="px-3 pt-2.5 pb-1 text-[12.5px] text-[var(--fg-faint)]">
                  Pídele algo a Len…
                </div>
                <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
                  <div className="flex items-center gap-0.5">
                    <span className="grid h-7 w-7 place-items-center rounded-md text-[var(--fg-faint)]">
                      <ImageIcon size={14} />
                    </span>
                    <span className="grid h-7 w-7 place-items-center rounded-md text-[var(--fg-faint)]">
                      <Crosshair size={14} />
                    </span>
                    <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[10px] text-[var(--fg-muted)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#4285F4]" />
                      Pro
                      <ChevronDown size={11} />
                    </span>
                  </div>
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--accent-strong)] text-white">
                    <ArrowUp size={14} />
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* preview area — the finished NOIR page in the middle */}
          <div className="flex-1 min-w-0 flex flex-col bg-[var(--bg-preview)]">
            <div className="h-10 shrink-0 px-2.5 flex items-center gap-2 border-b border-[var(--border)]">
              <div className="inline-flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--bg-elev)] p-0.5">
                <span className="grid h-6 w-7 place-items-center rounded bg-[var(--bg)] text-[var(--fg)]">
                  <Monitor size={12} />
                </span>
                <span className="grid h-6 w-7 place-items-center rounded text-[var(--fg-faint)]">
                  <Tablet size={12} />
                </span>
                <span className="grid h-6 w-7 place-items-center rounded text-[var(--fg-faint)]">
                  <Smartphone size={12} />
                </span>
              </div>
              <span className="hidden lg:inline text-[10.5px] text-[var(--fg-faint)] tabular-nums px-1">
                Desktop · 1200 × 800 · 64%
              </span>
              <div className="ml-auto flex items-center gap-0.5 text-[var(--fg-muted)]">
                <span className="grid h-7 w-7 place-items-center rounded-md">
                  <Pencil size={12} />
                </span>
                <span className="grid h-7 w-7 place-items-center rounded-md">
                  <RefreshCw size={12} />
                </span>
                <span className="grid h-7 w-7 place-items-center rounded-md">
                  <ExternalLink size={12} />
                </span>
              </div>
            </div>

            {/* canvas: the real photographer page — full page, scrollable */}
            <div className="flex-1 min-h-0 overflow-hidden p-3 sm:p-4 grid place-items-center">
              <div className="relative h-full w-full max-w-[560px] mx-auto rounded-xl ring-1 ring-black/5 dark:ring-white/10 overflow-y-auto shadow-[0_24px_60px_-30px_rgba(0,0,0,0.35)] dark:shadow-[0_24px_60px_-30px_rgba(0,0,0,0.7)] bg-[#faf8f5]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/hero-margot.webp"
                  alt="Página de fotógrafo creada con Len"
                  className="block w-full h-auto"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              </div>
            </div>
          </div>

          {/* right inspector */}
          <div className="hidden xl:flex h-full w-[280px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-sidebar)]">
            <div className="flex items-center px-3 h-10 border-b border-[var(--border)]">
              <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--fg-faint)] font-semibold">
                Inspector
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {/* LOOKS */}
              <div className="px-3 py-3 border-b border-[var(--border)]">
                <span className="flex items-center gap-1.5 mb-2.5 text-[10px] uppercase tracking-[0.16em] text-[var(--fg-faint)] font-semibold">
                  <Sparkles size={11} /> Looks
                </span>
                <div className="flex flex-wrap gap-x-2 gap-y-3">
                  {[
                    { c: "#FF5A36", label: "Coral", sel: true },
                    { c: "#6366f1", label: "Indigo" },
                    { c: "#10b981", label: "Bosque" },
                    { c: "#f59e0b", label: "Ámbar" },
                    { c: "#0ea5e9", label: "Océano" },
                  ].map(({ c, label, sel }) => (
                    <span key={label} className="flex w-10 flex-col items-center gap-1.5">
                      <span
                        className={`h-8 w-8 rounded-full ${sel ? "ring-2 ring-offset-2 ring-[#FF5A36] ring-offset-[var(--bg-sidebar)]" : ""}`}
                        style={orb(c)}
                      />
                      <span className="text-[9.5px] text-[var(--fg-faint)] truncate max-w-full">
                        {label}
                      </span>
                    </span>
                  ))}
                  <span className="flex w-10 flex-col items-center gap-1.5">
                    <span className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-[var(--border)] bg-[var(--bg-elev)] text-[var(--fg-faint)] text-sm">
                      +
                    </span>
                    <span className="text-[9.5px] text-[var(--fg-faint)]">Más</span>
                  </span>
                </div>
                <div className="mt-3.5 flex items-center justify-between">
                  <span className="text-[12px] text-[var(--fg)]">Modo oscuro</span>
                  <span className="relative inline-flex h-4 w-7 rounded-full bg-[var(--accent)]">
                    <span className="absolute top-0.5 left-3.5 h-3 w-3 rounded-full bg-white" />
                  </span>
                </div>
              </div>
              {/* MOTION */}
              <div className="px-3 py-3 border-b border-[var(--border)]">
                <span className="flex items-center gap-1.5 mb-2.5 text-[10px] uppercase tracking-[0.16em] text-[var(--fg-faint)] font-semibold">
                  <Sparkles size={11} /> Motion
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {["Off", "Calm", "Editorial", "Dramatic"].map((m, i) => (
                    <span
                      key={m}
                      className={`h-7 px-2.5 grid place-items-center rounded-full text-[11px] font-medium ring-1 ${
                        i === 1
                          ? "bg-[var(--accent-strong)] text-white ring-transparent"
                          : "bg-[var(--bg-elev)] text-[var(--fg-muted)] ring-[var(--border)]"
                      }`}
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
              {/* PAGE */}
              <div className="px-3 py-3">
                <span className="flex items-center gap-1.5 mb-2.5 text-[10px] uppercase tracking-[0.16em] text-[var(--fg-faint)] font-semibold">
                  <Globe size={11} /> Página
                </span>
                <div className="space-y-2">
                  <div>
                    <span className="block text-[10.5px] text-[var(--fg-faint)] mb-1">Título</span>
                    <div className="h-7 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 grid items-center text-[12px] text-[var(--fg)]">
                      Margot Rey — fotografía
                    </div>
                  </div>
                  <div>
                    <span className="block text-[10.5px] text-[var(--fg-faint)] mb-1">Descripción</span>
                    <div className="h-12 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11.5px] leading-snug text-[var(--fg-muted)]">
                      Fotografía de moda y arte — galería blanca, luz de día.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
