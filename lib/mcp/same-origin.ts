// ¿VIENE DE NUESTRA WEB? La segunda puerta de los POST que deciden con la
// cookie de la sesión (consentimiento, aprobaciones, conexiones, tokens). La
// primera es la cookie de Auth.js, SameSite=Lax (medido el 11/10/2026). Un
// navegador manda `Origin` —o al menos `Sec-Fetch-Site`— en todo POST; si no
// viene ninguno no es un navegador, y entonces no lleva la cookie de nadie.
import { siteOrigin } from "./config";

type Env = Readonly<Record<string, string | undefined>>;

export function isSameOriginRequest(req: Request, env: Env = process.env): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin === "null") return false;
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return false;
    }
    if (origin.replace(/\/$/, "") === siteOrigin(env)) return true;
    // En local (y detrás de Caddy, que lo conserva) el host de la propia petición.
    const own = (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))?.split(",")[0]?.trim();
    return !!own && own === host;
  }
  const site = req.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}
