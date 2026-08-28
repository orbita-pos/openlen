import { getTranslations } from "next-intl/server";
import { listPostTemplates } from "@/lib/marketing/post-templates/store";
import {
  BarChart3,
  Eye,
  Inbox,
  Languages,
  LayoutGrid,
  MessageCircle,
  Share2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Marketing showcase for the two things every published OpenLen page gets for
// free: privacy-first analytics + lead forms. The dashboard + inbox are
// designed mockups (no data fetch) but every metric mirrors what
// lib/analytics/queries.ts actually computes — views, uniques, referrers,
// per-link clicks, form submissions — so the section sells the real product,
// not vapor. Numbers are at single-page scale (honest, not a platform brag).

// ── chart geometry (deterministic, computed once at module load) ──────────
const PAGEVIEWS = [180, 240, 210, 300, 280, 360, 330, 420, 390, 470, 440, 512];
const VISITORS = [110, 150, 130, 180, 170, 210, 200, 250, 230, 280, 260, 312];
const CHART_W = 600;
const CHART_H = 200;
const PAD_X = 10;
const PAD_TOP = 18;
const PAD_BOTTOM = 10;
const CHART_MAX = Math.max(...PAGEVIEWS) * 1.12;

function xAt(i: number, n: number): number {
  return PAD_X + (i * (CHART_W - PAD_X * 2)) / (n - 1);
}
function yAt(v: number): number {
  return PAD_TOP + (1 - v / CHART_MAX) * (CHART_H - PAD_TOP - PAD_BOTTOM);
}
function linePath(vals: number[]): string {
  return vals
    .map((v, i) => `${i ? "L" : "M"}${xAt(i, vals.length).toFixed(1)} ${yAt(v).toFixed(1)}`)
    .join(" ");
}
function areaPath(vals: number[]): string {
  const n = vals.length;
  return `${linePath(vals)} L${xAt(n - 1, n).toFixed(1)} ${CHART_H - PAD_BOTTOM} L${xAt(0, n).toFixed(1)} ${CHART_H - PAD_BOTTOM} Z`;
}

const PV_LINE = linePath(PAGEVIEWS);
const PV_AREA = areaPath(PAGEVIEWS);
const VIS_LINE = linePath(VISITORS);
const VIS_AREA = areaPath(VISITORS);

// Top sources mirror getTopReferrers() output — real referrer hosts, grouped.
const SOURCES: { host: string; count: string; tint: string }[] = [
  { host: "google.com", count: "1,204", tint: "#4285F4" },
  { host: "chatgpt.com", count: "642", tint: "#10A37F" },
  { host: "instagram.com", count: "389", tint: "#E1306C" },
  { host: "x.com", count: "256", tint: "#71767b" },
  { host: "github.com", count: "141", tint: "#8b5cf6" },
];

// Lead samples — names/emails are universal data; the message snippet is the
// only translated string (analyticsLeads.leads.msg1..3).
const LEADS: { name: string; email: string; initials: string; tint: string }[] = [
  { name: "Marcus Lee", email: "marcus@northpeak.io", initials: "ML", tint: "#FF5A36" },
  { name: "Sofía Romero", email: "sofia.r@gmail.com", initials: "SR", tint: "#8b5cf6" },
  { name: "Devon Carter", email: "devon@boltworks.co", initials: "DC", tint: "#0ea5e9" },
];

// Module chips for the "one switch away" card.
//
// 🔴 ESTA LISTA PROMETÍA CUATRO MÓDULOS QUE YA NO EXISTEN. Decía —y el
// comentario lo afirmaba— «each is a real, shipped OpenLen module: bookings,
// WhatsApp orders, members, comments, chat, i18n». Reservas, Pedidos, Miembros
// y Comentarios se RETIRARON el 2026-08-21; la landing siguió vendiéndolos.
// Alguien se registraba por Reservas y no las encontraba.
//
// Lo que existe hoy son TRES módulos —`AGENT_MODULES` es ["collections",
// "chat"] y el panel sólo importa ChatSettings + CollectionsSettings— más
// Plataformas. Multilingüe no es un módulo pero sí una función real de
// publicación (Speak Every Language), y se queda porque no promete un
// interruptor que no está.
const MODULE_CHIPS: { icon: LucideIcon; labelKey: string }[] = [
  { icon: MessageCircle, labelKey: "analyticsLeads.extras.modules.items.chat" },
  { icon: LayoutGrid, labelKey: "analyticsLeads.extras.modules.items.collections" },
  { icon: Share2, labelKey: "analyticsLeads.extras.modules.items.platforms" },
  { icon: Languages, labelKey: "analyticsLeads.extras.modules.items.multilingual" },
];

const CELL =
  "group relative overflow-hidden rounded-3xl bg-white/70 dark:bg-white/[0.04] ring-1 ring-zinc-200/70 dark:ring-white/10 backdrop-blur-sm p-6 sm:p-7 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-coral-950/[0.07] dark:hover:shadow-black/30";

export async function AnalyticsLeads() {
  const t = await getTranslations("marketing");
  // El chip decía «56 posts · 312 textos», cableado. La base tiene 60 y el
  // catálogo crece: un número a mano de algo que crece caduca solo. Fail-soft
  // a 0 — una landing no se cae porque la base tarde.
  const posts = await listPostTemplates()
    .then((p) => p.length)
    .catch(() => 0);

  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="max-w-2xl">
          <Badge tone="coral">
            <BarChart3 size={11} /> {t("analyticsLeads.badge")}
          </Badge>
          <h2 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-tightest leading-[1.08]">
            {t.rich("analyticsLeads.title", {
              muted: (chunks) => (
                <span className="serif-accent bg-gradient-to-br from-coral-500 via-coral-600 to-rose-500 bg-clip-text text-transparent pr-[0.04em]">
                  {chunks}
                </span>
              ),
            })}
          </h2>
          <p className="mt-4 text-pretty text-zinc-600 dark:text-zinc-400 leading-relaxed">
            {t("analyticsLeads.subtitle")}
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
          <DashboardMock />
          <LeadsMock />
        </div>

        {/* The rest of the results loop — real shipped features, drawn as
            product artifacts instead of icon cards. */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Marketing Kit — two mini social posts in the page's palette. */}
          <div className={CELL}>
            <div className="flex gap-3" aria-hidden>
              <div className="relative h-28 flex-1 overflow-hidden rounded-xl bg-gradient-to-br from-coral-500 via-coral-600 to-rose-600 p-3 rotate-[-1.2deg] transition-transform duration-300 group-hover:rotate-0">
                <div className="h-1.5 w-14 rounded-full bg-white/85" />
                <div className="mt-1.5 h-1.5 w-20 rounded-full bg-white/50" />
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                  <span className="serif-accent text-[15px] text-white/95">Margot Rey</span>
                  <span className="h-3 w-3 rounded-full bg-white/80" />
                </div>
              </div>
              <div className="relative h-28 flex-1 overflow-hidden rounded-xl bg-white dark:bg-zinc-950/60 ring-1 ring-zinc-200/80 dark:ring-white/10 p-3 rotate-[1.2deg] transition-transform duration-300 group-hover:rotate-0">
                <div className="flex gap-1">
                  {["#FF5A36", "#f43f5e", "#a78bfa", "#2a2140"].map((c) => (
                    <span key={c} className="h-3.5 w-3.5 rounded-full ring-2 ring-white dark:ring-zinc-900" style={{ background: c }} />
                  ))}
                </div>
                <div className="mt-2.5 h-1.5 w-16 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                <div className="mt-1.5 h-1.5 w-12 rounded-full bg-zinc-100 dark:bg-zinc-800" />
                <span className="absolute bottom-3 left-3 inline-flex rounded-full bg-coral-500/10 px-2 py-0.5 text-[9px] font-semibold text-coral-700 dark:text-coral-300">
                  {t("analyticsLeads.extras.kit.chip", { posts })}
                </span>
              </div>
            </div>
            <h3 className="mt-5 text-[15px] font-semibold tracking-tight">
              {t("analyticsLeads.extras.kit.title")}
            </h3>
            <p className="mt-1.5 text-[13px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {t("analyticsLeads.extras.kit.body")}
            </p>
          </div>

          {/* Page Coach — the funnel it reads + the advice it gives. */}
          <div className={CELL}>
            <div className="space-y-1.5" aria-hidden>
              {[
                [t("analyticsLeads.extras.coach.funnel.visits"), 100, "2,341"],
                [t("analyticsLeads.extras.coach.funnel.clicks"), 38, "894"],
                [t("analyticsLeads.extras.coach.funnel.leads"), 9, "212"],
              ].map(([label, pct, n]) => (
                <div key={String(label)} className="flex items-center gap-2">
                  <span className="w-14 truncate text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                    {label}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800/70">
                    <div
                      className="h-full rounded-md bg-gradient-to-r from-coral-500/80 to-coral-400/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-[10px] tabular-nums text-zinc-400">
                    {n}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-xl border-l-2 border-coral-500 bg-coral-50/70 dark:bg-coral-500/[0.08] px-3 py-2.5">
              <p className="text-[12px] leading-snug text-zinc-700 dark:text-zinc-300">
                <span className="mr-1" aria-hidden>✦</span>
                {t("analyticsLeads.extras.coach.tip")}
              </p>
            </div>
            <h3 className="mt-5 text-[15px] font-semibold tracking-tight">
              {t("analyticsLeads.extras.coach.title")}
            </h3>
            <p className="mt-1.5 text-[13px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {t("analyticsLeads.extras.coach.body")}
            </p>
          </div>

          {/* Modules — the real switches, as chips. */}
          <div className={CELL}>
            <div className="flex flex-wrap gap-2">
              {MODULE_CHIPS.map((m) => {
                const Icon = m.icon;
                return (
                  <span
                    key={m.labelKey}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white dark:bg-zinc-950/60 ring-1 ring-zinc-200/80 dark:ring-white/10 px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    <Icon size={11} className="text-coral-600 dark:text-coral-400" />
                    {t(m.labelKey)}
                  </span>
                );
              })}
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500"
                aria-hidden
              >
                +
              </span>
            </div>
            <h3 className="mt-5 text-[15px] font-semibold tracking-tight">
              {t("analyticsLeads.extras.modules.title")}
            </h3>
            <p className="mt-1.5 text-[13px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {t("analyticsLeads.extras.modules.body")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── analytics dashboard mockup (left, lg:col-span-7) ──────────────────────
async function DashboardMock() {
  const t = await getTranslations("marketing");
  return (
    <div className="lg:col-span-7 relative overflow-hidden rounded-3xl ring-1 ring-zinc-200/70 dark:ring-white/[0.08] bg-white/80 dark:bg-[#0c0c0d] backdrop-blur-sm shadow-sm">
      {/* subtle top glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/3 h-48 w-72 rounded-full bg-coral-500/10 blur-3xl"
      />
      <div className="relative p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {t("analyticsLeads.dashboard.title")}
          </h3>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {t("analyticsLeads.dashboard.range")}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Kpi
            icon={
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
            }
            label={t("analyticsLeads.dashboard.live")}
            value="6"
          />
          <Kpi
            icon={<Users size={11} className="text-zinc-400" />}
            label={t("analyticsLeads.dashboard.uniques")}
            value="2,341"
          />
          <Kpi
            icon={<Eye size={11} className="text-zinc-400" />}
            label={t("analyticsLeads.dashboard.pageviews")}
            value="5,907"
          />
        </div>

        {/* area chart */}
        <div className="relative mt-5">
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="w-full h-36"
            preserveAspectRatio="none"
            role="img"
            aria-label={t("analyticsLeads.dashboard.chartAria")}
          >
            <defs>
              <linearGradient id="ol-pv-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF5A36" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#FF5A36" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="ol-vis-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={VIS_AREA} fill="url(#ol-vis-fill)" />
            <path d={PV_AREA} fill="url(#ol-pv-fill)" />
            <path
              d={VIS_LINE}
              fill="none"
              stroke="#6366f1"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={PV_LINE}
              fill="none"
              stroke="#FF5A36"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {/* floating point tooltip, à la the real Insights hover */}
          <div className="absolute left-[52%] top-1 rounded-lg ring-1 ring-zinc-200 dark:ring-white/10 bg-white/95 dark:bg-zinc-900/95 backdrop-blur px-2.5 py-2 shadow-lg">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
              {t("analyticsLeads.dashboard.tooltipDay")}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-coral-500" />
              <span className="text-zinc-500 dark:text-zinc-400">
                {t("analyticsLeads.dashboard.pageviews")}
              </span>
              <span className="ml-auto font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                512
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              <span className="text-zinc-500 dark:text-zinc-400">
                {t("analyticsLeads.dashboard.visitors")}
              </span>
              <span className="ml-auto font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                312
              </span>
            </div>
          </div>
        </div>

        {/* top sources */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
              {t("analyticsLeads.dashboard.sources")}
            </span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {t("analyticsLeads.dashboard.referrer")}
            </span>
          </div>
          <ul className="space-y-1.5">
            {SOURCES.map((s) => (
              <li key={s.host} className="flex items-center gap-2.5">
                <span
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[8px] font-bold text-white"
                  style={{ background: s.tint }}
                  aria-hidden
                >
                  {s.host.charAt(0).toUpperCase()}
                </span>
                <span className="text-[12px] text-zinc-700 dark:text-zinc-300">
                  {s.host}
                </span>
                <span className="ml-auto text-[12px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                  {s.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl ring-1 ring-zinc-200/70 dark:ring-white/[0.06] bg-zinc-50/60 dark:bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
    </div>
  );
}

// ── leads inbox mockup (right, lg:col-span-5) ─────────────────────────────
async function LeadsMock() {
  const t = await getTranslations("marketing");
  const msgKeys = [
    "analyticsLeads.leads.msg1",
    "analyticsLeads.leads.msg2",
    "analyticsLeads.leads.msg3",
  ] as const;
  const times = ["2m", "1h", "3h"];
  return (
    <div className="lg:col-span-5 flex flex-col rounded-3xl ring-1 ring-zinc-200/70 dark:ring-white/[0.08] bg-white/80 dark:bg-[#0c0c0d] backdrop-blur-sm shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-zinc-200/70 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Inbox size={15} className="text-coral-600 dark:text-coral-400" />
          <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {t("analyticsLeads.leads.title")}
          </h3>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-coral-50 dark:bg-coral-500/10 px-2 py-0.5 text-[10px] font-semibold text-coral-700 dark:text-coral-300">
          {t("analyticsLeads.leads.newCount", { count: 3 })}
        </span>
      </div>

      <ul className="flex-1 divide-y divide-zinc-100 dark:divide-white/[0.05]">
        {LEADS.map((lead, i) => (
          <li
            key={lead.email}
            className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-50/70 dark:hover:bg-white/[0.02]"
          >
            <span
              className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
              style={{ background: lead.tint }}
              aria-hidden
            >
              {lead.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                  {lead.name}
                </span>
                {i === 0 && (
                  <span className="shrink-0 inline-block h-1.5 w-1.5 rounded-full bg-coral-500" />
                )}
                <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-zinc-400 dark:text-zinc-500">
                  {times[i]}
                </span>
              </div>
              <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {lead.email}
              </div>
              <p className="mt-1 line-clamp-2 text-[12px] text-zinc-600 dark:text-zinc-300 leading-snug">
                {t(msgKeys[i])}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/60 dark:bg-white/[0.02]">
        <span
          aria-hidden
          className="inline-flex h-5 w-5 items-center justify-center rounded bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[10px] font-bold"
        >
          ✦
        </span>
        <span className="text-[11.5px] text-zinc-600 dark:text-zinc-400">
          {t("analyticsLeads.leads.emailNotice")}
        </span>
      </div>
    </div>
  );
}
