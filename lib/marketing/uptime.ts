// Badge de uptime para la sección de confianza del home. Lee el summary
// público del status worker y degrada a null ante CUALQUIER fallo — la
// sección muestra copy alterno y el home jamás se bloquea por esto.

export interface UptimeBadge {
  pct: string;
  window: "d90" | "d7" | "d1";
  up: boolean;
}

interface WindowSet {
  d1: number | null;
  d7: number | null;
  d90: number | null;
}

export interface SummaryTargets {
  app: { status: "up" | "down"; uptime: WindowSet };
  pages: { status: "up" | "down"; uptime: WindowSet };
  api: { status: "up" | "down"; uptime: WindowSet };
}

interface Summary {
  overall: "up" | "degraded";
  targets: SummaryTargets;
  generatedAt: number;
}

// Overridable para self-hosters del repo AGPL y para el screenshot del
// estado fallback (apuntarla a un host muerto).
const SUMMARY_URL =
  process.env.OPENLEN_STATUS_SUMMARY_URL ?? "https://status.openlen.com/api/summary";

// Floor a 2 decimales: el claim de marketing jamás redondea hacia arriba
// (99.996 debe decir "99.99%", nunca "100%"). JS recorta ceros finales solo.
export function formatPct(n: number): string {
  return `${Math.floor(n * 100) / 100}%`;
}

const WINDOWS = ["d90", "d7", "d1"] as const;

export function pickWindow(
  targets: SummaryTargets,
): { window: "d90" | "d7" | "d1"; min: number } | null {
  for (const w of WINDOWS) {
    const values = [targets.app.uptime[w], targets.pages.uptime[w], targets.api.uptime[w]];
    if (values.every((v): v is number => typeof v === "number")) {
      return { window: w, min: Math.min(...(values as number[])) };
    }
  }
  return null;
}

export async function getUptimeBadge(
  fetcher: typeof fetch = fetch,
): Promise<UptimeBadge | null> {
  try {
    const res = await fetcher(SUMMARY_URL, {
      signal: AbortSignal.timeout(3000),
      next: { revalidate: 300 },
    } as RequestInit);
    if (!res.ok) return null;
    const data = (await res.json()) as Summary;
    const picked = pickWindow(data.targets);
    if (!picked) return null;
    return { pct: formatPct(picked.min), window: picked.window, up: data.overall === "up" };
  } catch {
    return null;
  }
}
