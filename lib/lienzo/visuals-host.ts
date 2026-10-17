/**
 * THE HOST OF THE VISUALS FRAME (local spec 2026-10-16-len-inline-visuals, §4.3).
 *
 * Len's visuals run in an iframe served from `lienzo-visuals.<lienzo domain>`:
 * another site than openlen.com, with nothing of anyone's on it (no project
 * files, no cookies of the app). Locally it is `lienzo-visuals.localhost`, the
 * way the lienzo runs locally. Server-only, like `host.ts`.
 */
import { esPeticionLocal, esProduccion, lienzoApagado, lienzoBaseHost, origenDeLaApp } from "./host";
import { VISUALS_LABEL } from "./prefijo";

type Env = Readonly<Record<string, string | undefined>>;

function portOf(host: string | null): string | null {
  return /:(\d+)$/.exec(String(host ?? ""))?.[1] ?? null;
}

/** Where the chat loads the frame from; `null` = no isolated host here, and the
 *  chat falls back to a `srcdoc` frame without `allow-same-origin`. */
export function visualFrameUrl(input: { hostDeLaPeticion: string | null }, env: Env = process.env): string | null {
  if (lienzoApagado(env)) return null;
  if (esProduccion(env) && !esPeticionLocal(input.hostDeLaPeticion)) {
    const base = lienzoBaseHost(env);
    return base ? `https://${VISUALS_LABEL}.${base}/` : null;
  }
  const port = portOf(input.hostDeLaPeticion);
  return `http://${VISUALS_LABEL}.localhost${port ? `:${port}` : ""}/`;
}

/** The origins the frame takes messages from: the app, and locally also the
 *  workspace on localhost / 127.0.0.1 at the request's port. */
export function visualFrameParentOrigins(input: { hostDeLaPeticion: string | null }, env: Env = process.env): string[] {
  const origins = [origenDeLaApp(env)];
  if (!esProduccion(env) || esPeticionLocal(input.hostDeLaPeticion)) {
    const port = portOf(input.hostDeLaPeticion);
    const suffix = port ? `:${port}` : "";
    origins.push(`http://localhost${suffix}`, `http://127.0.0.1${suffix}`);
  }
  return [...new Set(origins)];
}
