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
    labels: { app: "Aplicación", pages: "Páginas publicadas", api: "API y datos" } as Record<Target, string>,
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
    labels: { app: "Application", pages: "Published pages", api: "API & data" } as Record<Target, string>,
  },
};

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const DAY_COLOR: Record<DayCell["state"], string> = {
  ok: "#22c55e",
  degraded: "#f59e0b",
  outage: "#ef4444",
  empty: "#3f3f46",
};

export function renderHtml(data: PageData, lang: "es" | "en"): string {
  const s = STR[lang];
  const anyDown = data.targets.some((t) => t.status === "down");
  const rows = data.targets
    .map((t) => {
      const bars = t.days
        .map(
          (d) =>
            `<i title="${d.day}" style="background:${DAY_COLOR[d.state]}"></i>`,
        )
        .join("");
      return `
    <section class="card">
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
    </section>`;
    })
    .join("\n");

  const incidents =
    data.incidents.length === 0
      ? `<p class="empty">${s.noIncidents}</p>`
      : `<ul>${data.incidents
          .map(
            (i) =>
              `<li><b>${s.labels[i.target]}</b> — ${new Date(i.start)
                .toISOString()
                .replace("T", " ")
                .slice(0, 16)} UTC · ${i.durationMin} ${s.minutes}</li>`,
          )
          .join("")}</ul>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${s.title}</title>
<style>
  :root { color-scheme: light dark; --coral: #ff5a36; --fg: #18181b; --bg: #fafafa; --card: #fff; --muted: #71717a; --line: #e4e4e7; }
  @media (prefers-color-scheme: dark) { :root { --fg: #fafafa; --bg: #0a0a0a; --card: #141416; --muted: #a1a1aa; --line: #27272a; } }
  * { box-sizing: border-box; margin: 0; }
  body { font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--fg); padding: 40px 16px; }
  main { max-width: 640px; margin: 0 auto; display: grid; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .brand b { font-size: 18px; }
  .lens { width: 22px; height: 22px; border-radius: 50%; border: 5px solid var(--coral); display: inline-block; }
  .overall { padding: 14px 18px; border-radius: 12px; font-weight: 600; color: #fff; background: ${anyDown ? "#ef4444" : "#22c55e"}; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; }
  .card header { display: flex; align-items: center; gap: 10px; }
  .card h2 { font-size: 15px; font-weight: 600; flex: 1; }
  .lat { color: var(--muted); font-size: 13px; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .status-dot.up { background: #22c55e; }
  .status-dot.down { background: #ef4444; }
  .bars { display: flex; gap: 2px; margin: 12px 0 8px; }
  .bars i { flex: 1; height: 26px; border-radius: 2px; min-width: 2px; }
  .card footer { display: flex; gap: 16px; color: var(--muted); font-size: 13px; }
  h3 { font-size: 14px; color: var(--muted); margin-top: 8px; }
  ul { padding-left: 18px; } li { margin: 4px 0; }
  .empty { color: var(--muted); }
  .foot { color: var(--muted); font-size: 12px; }
  .foot a { color: var(--coral); }
</style>
</head>
<body>
<main>
  <div class="brand"><span class="lens"></span><b>OpenLen</b></div>
  <div class="overall">${anyDown ? s.partial : s.allUp}</div>
  ${rows}
  <h3>${s.incidents}</h3>
  ${incidents}
  <p class="foot">${s.updated} ${new Date(data.generatedAt).toISOString().replace("T", " ").slice(0, 16)} UTC ·
    <a href="https://github.com/orbita-pos/openlen" rel="noopener">open source</a></p>
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
