import type { DayCell, Incident, Target } from "./logic";
import { TARGET_LABEL } from "./email";

export interface TargetView {
  target: Target;
  status: "up" | "down";
  since: number;
  lastLatencyMs: number | null;
  uptime: { d1: number | null; d7: number | null; d90: number | null };
  days: DayCell[];
}

export interface PageData {
  generatedAt: number;
  targets: TargetView[];
  incidents: Incident[];
}

export function pickLang(acceptLanguage: string | null): "es" | "en" {
  if (!acceptLanguage) return "es";
  return /\bes\b|es-/i.test(acceptLanguage) ? "es" : "en";
}

const STR = {
  es: {
    title: "Estado de OpenLen",
    allUp: "Todos los sistemas operando",
    partial: "Interrupción parcial",
    uptimeCols: ["24 h", "7 días", "90 días"],
    incidents: "Incidentes — últimos 90 días",
    noIncidents: "Sin incidentes en los últimos 90 días",
    minutes: "min",
    updated: "Actualizado",
    refresh: "se verifica cada 5 minutos",
    openSource: "código abierto",
    description:
      "Estado en vivo de OpenLen: aplicación, páginas publicadas y API, verificado cada 5 minutos desde fuera de nuestra infraestructura.",
    labels: TARGET_LABEL,
  },
  en: {
    title: "OpenLen Status",
    allUp: "All systems operational",
    partial: "Partial outage",
    uptimeCols: ["24 h", "7 days", "90 days"],
    incidents: "Incidents — last 90 days",
    noIncidents: "No incidents in the last 90 days",
    minutes: "min",
    updated: "Updated",
    refresh: "checked every 5 minutes",
    openSource: "open source",
    description:
      "Live status of OpenLen: application, published pages and API, checked every 5 minutes from outside our infrastructure.",
    labels: { app: "Application", pages: "Published pages", api: "API & data" } as Record<Target, string>,
  },
};

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

// The brand lens ring — same warm gradient as components/openlen-logo.tsx.
const LENS_SVG = `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="lens-grad" x1="14" y1="11" x2="52" y2="55" gradientUnits="userSpaceOnUse">
            <stop stop-color="#FF7E55"/><stop offset="0.52" stop-color="#FF5A36"/><stop offset="1" stop-color="#E5391A"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="22" stroke="url(#lens-grad)" stroke-width="9"/>
      </svg>`;

export function renderHtml(data: PageData, lang: "es" | "en"): string {
  const s = STR[lang];
  const anyDown = data.targets.some((t) => t.status === "down");
  const rows = data.targets
    .map((t, i) => {
      const bars = t.days.map((d) => `<i class="d-${d.state}" title="${d.day}"></i>`).join("");
      return `
    <article class="row"${i > 0 ? ' data-sep=""' : ""}>
      <header>
        <span class="status-dot ${t.status}"></span>
        <h2>${s.labels[t.target]}</h2>
        <span class="lat">${t.lastLatencyMs === null ? "" : `${t.lastLatencyMs} ms`}</span>
      </header>
      <div class="bars">${bars}</div>
      <footer>
        <span>${s.uptimeCols[0]} · ${pct(t.uptime.d1)}</span>
        <span>${s.uptimeCols[1]} · ${pct(t.uptime.d7)}</span>
        <span>${s.uptimeCols[2]} · ${pct(t.uptime.d90)}</span>
      </footer>
    </article>`;
    })
    .join("\n");

  const incidents =
    data.incidents.length === 0
      ? `<p class="empty"><span class="okdot"></span>${s.noIncidents}</p>`
      : `<ul class="timeline">${data.incidents
          .map(
            (i) =>
              `<li><span class="tl-dot"></span><div><b>${s.labels[i.target]}</b><time>${new Date(i.start)
                .toISOString()
                .replace("T", " ")
                .slice(0, 16)} UTC · ${i.durationMin} ${s.minutes}</time></div></li>`,
          )
          .join("")}</ul>`;

  const stamp = new Date(data.generatedAt).toISOString().replace("T", " ").slice(0, 16);

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${s.description}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='22' fill='none' stroke='%23FF5A36' stroke-width='14'/%3E%3C/svg%3E">
<title>${s.title}</title>
<style>
  :root {
    color-scheme: light dark;
    --coral: #ff5a36;
    /* Texto acento: el coral puro falla AA sobre blanco; el stop oscuro del
       gradiente del logo sí pasa. En dark se aclara. */
    --coral-text: #d13416;
    --fg: #18181b; --bg: #ffffff; --card: #ffffff; --muted: #6b6b76; --line: #e9e9ee;
    --soft: #f7f7f9;
    --ok: #10b981; --warn: #f59e0b; --bad: #ef4444; --empty: #e4e4ea;
    --halo-a: rgba(255,126,85,.26); --halo-b: rgba(253,164,175,.20); --halo-c: rgba(196,181,253,.24);
    --shadow: 0 1px 2px rgba(24,24,27,.05), 0 12px 32px -16px rgba(24,24,27,.12);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --coral-text: #ff8a63;
      --fg: #f4f4f5; --bg: #0a0a0a; --card: #131315; --muted: #9d9da8; --line: #232329;
      --soft: #18181b;
      --ok: #2dd48f; --warn: #fbbf24; --bad: #f87171; --empty: #232329;
      --halo-a: rgba(255,110,70,.15); --halo-b: rgba(251,113,133,.10); --halo-c: rgba(167,139,250,.13);
      --shadow: 0 1px 2px rgba(0,0,0,.4), 0 16px 40px -20px rgba(0,0,0,.6);
    }
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--bg); color: var(--fg);
    padding: clamp(28px, 6vw, 72px) 20px 48px;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 640px; margin: 0 auto; }

  /* ── hero: la lente mirando el sistema, con el amanecer del home detrás ── */
  .hero { position: relative; text-align: center; padding: 26px 0 38px; }
  .dawn {
    position: absolute; inset: -40px -60px 0; pointer-events: none; z-index: -1;
    background: linear-gradient(105deg, var(--halo-a), var(--halo-b) 46%, var(--halo-c));
    filter: blur(52px); border-radius: 100px;
  }
  .lens { width: 52px; height: 52px; display: inline-grid; place-items: center; position: relative; }
  .lens svg { width: 52px; height: 52px; display: block; }
  .lens .core {
    position: absolute; width: 11px; height: 11px; border-radius: 50%;
    background: var(--ok); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok) 22%, transparent), 0 0 14px var(--ok);
  }
  .lens .core.down { background: var(--bad); box-shadow: 0 0 0 4px color-mix(in srgb, var(--bad) 22%, transparent), 0 0 14px var(--bad); }
  .eyebrow {
    margin-top: 18px; font-size: 12px; font-weight: 600; letter-spacing: .14em;
    text-transform: uppercase; color: var(--muted);
  }
  .eyebrow em { font-family: Georgia, "Times New Roman", serif; font-style: italic; text-transform: none;
    letter-spacing: 0; font-size: 14px; color: var(--coral-text); }
  h1 {
    margin-top: 10px; font-size: clamp(26px, 5.4vw, 34px); font-weight: 700;
    letter-spacing: -0.035em; line-height: 1.12; text-wrap: balance;
  }
  .sub { margin-top: 10px; color: var(--muted); font-size: 13.5px; }
  .sub b { font-weight: 500; color: var(--fg); }

  /* ── panel único con los 3 componentes ── */
  .panel {
    background: var(--card); border: 1px solid var(--line); border-radius: 18px;
    box-shadow: var(--shadow); padding: 6px 22px; overflow: hidden;
  }
  .row { padding: 18px 0 16px; }
  .row[data-sep] { border-top: 1px solid var(--line); }
  .row header { display: flex; align-items: center; gap: 10px; }
  .row h2 { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; flex: 1; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .status-dot.up { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 18%, transparent); }
  .status-dot.down { background: var(--bad); box-shadow: 0 0 0 3px color-mix(in srgb, var(--bad) 18%, transparent); }
  .lat {
    font-variant-numeric: tabular-nums; font-size: 12px; color: var(--muted);
    background: var(--soft); border: 1px solid var(--line); border-radius: 99px; padding: 2px 9px;
  }
  .bars { display: flex; gap: 2px; height: 30px; margin: 13px 0 9px; }
  .bars i { flex: 1; min-width: 2px; border-radius: 99px; }
  .d-ok { background: var(--ok); opacity: .88; }
  .d-degraded { background: var(--warn); }
  .d-outage { background: var(--bad); }
  .d-empty { background: var(--empty); }
  .bars i:hover { transform: scaleY(1.12); }
  .row footer {
    display: flex; gap: 18px; color: var(--muted); font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }
  .row footer span:last-child { margin-left: auto; }

  /* ── incidentes ── */
  h3 {
    margin: 34px 2px 14px; font-size: 12px; font-weight: 600; letter-spacing: .12em;
    text-transform: uppercase; color: var(--muted);
  }
  .empty { color: var(--muted); font-size: 14px; padding: 2px; display: flex; align-items: center; gap: 8px; }
  .okdot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); flex: none; }
  .timeline { list-style: none; padding: 0; display: grid; gap: 4px; }
  .timeline li {
    display: flex; gap: 12px; align-items: baseline; padding: 10px 2px;
    border-top: 1px solid var(--line);
  }
  .timeline li:first-child { border-top: 0; }
  .tl-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--bad); flex: none; position: relative; top: -1px; }
  .timeline b { font-size: 14px; font-weight: 600; display: block; }
  .timeline time { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }

  /* ── footer ── */
  .foot {
    margin-top: 40px; display: flex; align-items: center; justify-content: center; gap: 8px;
    color: var(--muted); font-size: 12.5px;
  }
  .foot svg { width: 14px; height: 14px; }
  .foot a { color: var(--coral-text); text-decoration: none; }
  .foot a:hover { text-decoration: underline; }

  /* ── entrada orquestada, respetando reduced-motion ──
     Solo transform: animar opacity desde 0 en toda la página corre en el
     compositor sin paints contentful y Lighthouse reporta NO_FCP. */
  @media (prefers-reduced-motion: no-preference) {
    .hero, .panel, h3, .empty, .timeline, .foot {
      animation: rise .5s cubic-bezier(.2,.7,.2,1) both;
    }
    .panel { animation-delay: .06s; }
    h3, .empty, .timeline { animation-delay: .12s; }
    .foot { animation-delay: .18s; }
    @keyframes rise { from { transform: translateY(12px); } }
  }
</style>
</head>
<body>
<main>
  <header class="hero">
    <div class="dawn"></div>
    <span class="lens">
      ${LENS_SVG}
      <span class="core${anyDown ? " down" : ""}"></span>
    </span>
    <p class="eyebrow">OpenLen <em>status</em></p>
    <h1>${anyDown ? s.partial : s.allUp}</h1>
    <p class="sub"><b>${s.updated} ${stamp} UTC</b> · ${s.refresh}</p>
  </header>

  <section class="panel">${rows}
  </section>

  <h3>${s.incidents}</h3>
  ${incidents}

  <footer class="foot">
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="20" stroke="#FF5A36" stroke-width="13"/></svg>
    OpenLen · <a href="https://github.com/orbita-pos/openlen" rel="noopener">${s.openSource}</a>
  </footer>
</main>
</body>
</html>`;
}

export function summaryJson(data: PageData): string {
  const anyDown = data.targets.some((t) => t.status === "down");
  const targets = Object.fromEntries(
    data.targets.map((t) => [t.target, { status: t.status, uptime: t.uptime }]),
  );
  return JSON.stringify({ overall: anyDown ? "degraded" : "up", targets, generatedAt: data.generatedAt });
}
