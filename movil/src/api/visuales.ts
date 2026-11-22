// WHERE THE PHONE LOADS LEN'S VISUALS FROM (spec local 2026-11-22-visuales-de-verdad, §1):
// asked once per app run (per authenticated client) to `/api/visual-frame-url`. `null` means no isolated host is
// available here and the visual falls back to a `srcdoc` frame without `allow-same-origin`.
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";

const cache = new WeakMap<ClienteDeOpenLen, Promise<string | null>>();

export function urlDelMarcoDeVisuales(c: ClienteDeOpenLen): Promise<string | null> {
  const cached = cache.get(c);
  if (cached) return cached;
  const req = c
    .pedir("/api/visual-frame-url")
    .then((r) => (r.ok ? r.json().catch(() => null) : null))
    .then((d: unknown) => {
      const url = (d as { url?: unknown } | null)?.url;
      return typeof url === "string" && url ? url : null;
    })
    .catch(() => null);
  cache.set(c, req);
  return req;
}
