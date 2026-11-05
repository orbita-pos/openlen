// WHAT A TOOL IS BORN WITH (spec local 2026-11-04-herramientas-hechas-por-len, §4.1): the app skeleton
// (`lib/apps/esqueleto.ts`) plus DeepSeek's display record — `package.json` with the vendor field and the two
// `exports`, `meta` in English and the person's language, and a placeholder icon the Creator must replace — and
// the types of `window.openlen`, the bridge OpenLen injects (§4.4).
import { createHash } from "node:crypto";

import { esqueletoDeApp } from "@/lib/apps/esqueleto";
import type { AppDeProyecto } from "@/lib/projects/types";

import type { ToolOfProject } from "./types";

const PLACEHOLDER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="4"/></svg>
`;

/** The placeholder's sha256: a manifest whose icon is still this one is refused («never accept default artwork»). */
export const PLACEHOLDER_ICON_SHA = createHash("sha256").update(PLACEHOLDER_ICON).digest("hex");

/** The bridge's types, global so `window.openlen` type-checks in the tool's sources. Keep in step with
 *  `lib/tools/bridge/protocol.ts`. */
export const OPENLEN_TYPES = `// window.openlen: the bridge between this tool and OpenLen. OpenLen installs it; read the
// tool-development skill's references/bridge.md before using it.

interface OpenLenToolContext {
  person: { name: string; locale: string };
  theme: { mode: "light" | "dark"; tokens: Record<string, string> };
  /** The open project, for a tool shown inside a project; null in the rail. */
  project: { id: string; title: string } | null;
  /** This tool: its own project's id (the same in the canvas, Len's eyes and installed) and the version it runs. */
  tool: { id: string; version: string };
  /** "draft" in this project's canvas and Len's eyes: writes to production are always refused there. */
  environment: "draft" | "installed";
}

type OpenLenUpdateResult =
  | { status: "applied"; row: Record<string, unknown> }
  | { status: "changed"; current: Record<string, unknown> | null }
  | { status: "declined" }
  | { status: "refused"; reason: "draft_no_production" | "eyes_never_write" | "owner_only" | "bad_change" };

/** forms(): counts over ALL the project's submissions, and "lista" — the ones in the range asked for (since/until),
 *  newest first, at most 50. "total" is every submission ever, not the range's: count the range with "lista". */
interface OpenLenFormsSummary {
  zona: string;
  sinVer: number;
  hoy: number;
  ayer: number;
  total: number;
  lista: Array<{ id: string; fecha: string; pagina: string | null; de: string | null; linea: string; visto: boolean }>;
}

interface OpenLenVisitCount {
  vistas: number;
  personas: number;
  clics: number;
}

/** visits(): fixed windows, and "rango" — the range asked for (from/to; the last 7 days by default). */
interface OpenLenVisitsSummary {
  zona: string;
  hoy: OpenLenVisitCount;
  ayer: OpenLenVisitCount;
  ultimos7: OpenLenVisitCount;
  ultimos30: OpenLenVisitCount;
  rango: {
    desde: string;
    hasta: string;
    total: OpenLenVisitCount;
    porDia: Array<{ dia: string; vistas: number }>;
    paginas: Array<{ pagina: string; vistas: number }>;
    deDonde: Array<{ origen: string; vistas: number }>;
    dispositivos: Array<{ dispositivo: string; vistas: number }>;
  };
  /** Set when the range asked for was cut to the days with detail. */
  recortadoDesde: string | null;
}

interface OpenLenBridge {
  context(): Promise<OpenLenToolContext>;
  onContext(callback: (context: OpenLenToolContext) => void): () => void;
  /** This tool's own backend, signed in as the person. */
  backend(): Promise<{ url: string; key: string; session: { access_token: string; refresh_token: string } & Record<string, unknown> }>;
  /** The projects the person can open, with their role in each: forms, visits and query answer only for "dueno". */
  projects(): Promise<Array<{ id: string; title: string; role: "dueno" | "editor" | "lector" }>>;
  /** Form submissions; dates as YYYY-MM-DD in the person's time zone. */
  forms(projectId: string, options?: { since?: string; until?: string }): Promise<OpenLenFormsSummary>;
  /** Visits; dates as YYYY-MM-DD. */
  visits(projectId: string, options?: { from?: string; to?: string }): Promise<OpenLenVisitsSummary>;
  /** SELECT only, on the project's production data. */
  query(projectId: string, sql: string): Promise<unknown>;
  /** Asks the person first, in a dialog OpenLen draws. */
  update(
    projectId: string,
    change: { table: string; key: Record<string, unknown>; set: Record<string, unknown>; before: Record<string, unknown> },
  ): Promise<OpenLenUpdateResult>;
  /** Puts the text in the person's chat with Len; they send it. Only inside a project. */
  sendPrompt(text: string): Promise<{ status: "placed" | "unavailable" }>;
}

interface Window {
  openlen: OpenLenBridge;
}
`;

const SUPABASE = `import { createClient } from "@supabase/supabase-js";

// This tool's backend: the project's URL and publishable key, public by design. OpenLen's bridge signs it in
// as the person using the tool, so row level security can use auth.uid().
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

/** Resolves once the client is signed in; await it before the first query. */
export const signedIn = window.openlen.backend().then(({ session }) =>
  supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }),
);
`;

function slug(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return s || "tool";
}

export function toolSkeleton(o: { readonly title: string; readonly locale: string }): {
  html: string;
  files: Record<string, string>;
  app: AppDeProyecto;
  tool: ToolOfProject;
} {
  const app = esqueletoDeApp({ titulo: o.title, idioma: o.locale });
  const appPackage = JSON.parse(app.ficheros["/package.json"] ?? "{}") as Record<string, unknown>;
  const pkg = {
    ...appPackage,
    name: slug(o.title),
    version: "1.0.0",
    openlen: { tool: { placement: "rail", jobs: {} } },
    exports: { "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
  };
  const meta = `${JSON.stringify({ meta: { title: o.title.trim() || "Tool", description: o.title.trim() || "A tool made by Len." } }, null, 2)}\n`;
  const locales = [...new Set(["en", o.locale])];
  return {
    html: app.html,
    app: app.app,
    tool: { bornAt: new Date().toISOString() },
    files: {
      ...app.ficheros,
      "/package.json": `${JSON.stringify(pkg, null, 2)}\n`,
      "/src/lib/supabase.ts": SUPABASE,
      "/src/openlen.d.ts": OPENLEN_TYPES,
      "/icon.svg": PLACEHOLDER_ICON,
      ...Object.fromEntries(locales.map((l) => [`/locale/${l}.json`, meta])),
    },
  };
}
