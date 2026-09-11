import { nextState } from "./logic";
import { runAllChecks } from "./checks";
import { sendAlert } from "./email";
import { pickLang, renderHtml, summaryJson, type PageData } from "./page";
import { gatherData, persistCheck, prune, readState, writeState } from "./store";

// Si D1 falla (cuota, caída), la excepción NO debe llegar a Cloudflare: sale un
// 1101 opaco. Así estuvo status semanas hasta el 2026-09-10. Un 503 dice lo que
// pasa, y el home ya lo degrada (`!res.ok` → sin badge de uptime).
async function tryGather(env: Env, now: number): Promise<PageData | null> {
  try {
    return await gatherData(env.DB, now);
  } catch (err) {
    console.error("gatherData failed", err);
    return null;
  }
}

const UNAVAILABLE_HEADERS = { "cache-control": "no-store", "retry-after": "60" };
const UNAVAILABLE_HTML =
  `<!doctype html><html lang="es"><meta charset="utf-8"><title>OpenLen Status</title>` +
  `<p>Estado no disponible temporalmente: el historial no se pudo leer. Vuelve a probar en un minuto.</p>` +
  `<p lang="en">Status temporarily unavailable. Please try again in a minute.</p></html>`;

export interface Env {
  DB: D1Database;
  CANARY_HOST: string;
  ALERT_FROM: string;
  ALERT_EMAIL: string;
  RESEND_API_KEY: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = Date.now();
    const results = await runAllChecks(env.CANARY_HOST);
    // Isolate target-level DB failures: one failure must not silence the others' state transitions
    for (const r of results) {
      try {
        await persistCheck(env.DB, r, now);

        const prev = await readState(env.DB, r.target);
        const { state, transition } = nextState(prev, r.ok, now);
        await writeState(env.DB, r.target, state);

        if (transition) {
          const downSince = transition === "recovered" ? (prev?.since ?? now) : now;
          ctx.waitUntil(sendAlert(transition, r.target, env, now, downSince));
        }
      } catch (err) {
        console.error("check persist failed", r.target, err);
      }
    }
    try {
      await prune(env.DB, now);
    } catch (err) {
      console.error("retention prune failed", err);
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.hostname !== "status.openlen.com") return new Response("Not found", { status: 404 });
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
      });
    }
    const now = Date.now();
    if (url.pathname === "/api/summary") {
      const data = await tryGather(env, now);
      if (!data) {
        return new Response(JSON.stringify({ error: "unavailable" }), {
          status: 503,
          headers: {
            ...UNAVAILABLE_HEADERS,
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "https://openlen.com",
          },
        });
      }
      return new Response(summaryJson(data), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=60",
          "access-control-allow-origin": "https://openlen.com",
        },
      });
    }
    if (url.pathname === "/") {
      const data = await tryGather(env, now);
      if (!data) {
        return new Response(UNAVAILABLE_HTML, {
          status: 503,
          headers: { ...UNAVAILABLE_HEADERS, "content-type": "text/html; charset=utf-8" },
        });
      }
      const lang = pickLang(req.headers.get("accept-language"));
      return new Response(renderHtml(data, lang), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=60",
          // The body varies by Accept-Language; without this a shared cache
          // could serve the ES render to an EN client.
          vary: "accept-language",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
