/**
 * THE HOST OF THE VISUALS FRAME (local spec 2026-10-16-len-inline-visuals, §4.3).
 *
 * Len's visuals run in an iframe served from `lienzo-visuals.<lienzo domain>`:
 * another site than openlen.com, with nothing of anyone's on it (no project
 * files, no cookies of the app). Locally it is `lienzo-visuals.localhost`, the
 * way the lienzo runs locally. Server-only, like `host.ts`.
 */
import { ORIGENES_DE_LA_APP } from "@/lib/movil/cors";
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

/** The phone app's origins that may frame the visuals host and talk to it (spec local 2026-11-22-visuales-de-verdad,
 *  §1): the packaged app's (`https://localhost`, `capacitor://localhost`) always; its plain-http dev server
 *  (`http://localhost:5173`) only outside production or for a local request — as the web's own localhost origins. */
export function phoneAppFrameOrigins(input: { hostDeLaPeticion: string | null }, env: Env = process.env): string[] {
  if (!esProduccion(env) || esPeticionLocal(input.hostDeLaPeticion)) return [...ORIGENES_DE_LA_APP];
  return ORIGENES_DE_LA_APP.filter((o) => !o.startsWith("http://"));
}

/** The origins the frame takes messages from: the web app, the phone app's
 *  (`phoneAppFrameOrigins`), and locally also the workspace on localhost /
 *  127.0.0.1 at the request's port. */
export function visualFrameParentOrigins(input: { hostDeLaPeticion: string | null }, env: Env = process.env): string[] {
  const origins = [origenDeLaApp(env), ...phoneAppFrameOrigins(input, env)];
  if (!esProduccion(env) || esPeticionLocal(input.hostDeLaPeticion)) {
    const port = portOf(input.hostDeLaPeticion);
    const suffix = port ? `:${port}` : "";
    origins.push(`http://localhost${suffix}`, `http://127.0.0.1${suffix}`);
  }
  return [...new Set(origins)];
}
