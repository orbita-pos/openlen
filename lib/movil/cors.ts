// CORS sólo para la app del teléfono. El middleware no corre en /api (su
// matcher lo excluye), así que cada ruta de LA lista lo lleva puesto con
// `paraLaApp` y exporta `OPTIONS = respuestaPrevia`. La app manda la llave en
// «Authorization», nunca cookies: no hay `allow-credentials` ni CSRF.
//   http://localhost:5173 — Vite en dev (la app recarga en vivo desde ahí)
//   https://localhost     — la app empaquetada en Android
//   capacitor://localhost — la app empaquetada en iPhone (para después)
export const ORIGENES_DE_LA_APP: readonly string[] = ["http://localhost:5173", "https://localhost", "capacitor://localhost"];

export function cabecerasCors(req: Request): Record<string, string> {
  const origen = req.headers.get("origin");
  if (!origen || !ORIGENES_DE_LA_APP.includes(origen)) return {};
  return {
    "access-control-allow-origin": origen,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

export function conCors(req: Request, res: Response): Response {
  const extra = cabecerasCors(req);
  if (Object.keys(extra).length === 0) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  // El cuerpo pasa tal cual: también el del SSE de /api/agent.
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// Dos firmas: un manejador que sólo recibe la petición queda igual de llamable
// (`GET(req)`), y uno con contexto (`{ params }`) lo conserva tipado.
export function paraLaApp(h: (req: Request) => Promise<Response>): (req: Request) => Promise<Response>;
export function paraLaApp<C>(h: (req: Request, ctx: C) => Promise<Response>): (req: Request, ctx: C) => Promise<Response>;
export function paraLaApp<C>(h: (req: Request, ctx?: C) => Promise<Response>): (req: Request, ctx?: C) => Promise<Response> {
  return async (req, ctx) => conCors(req, await h(req, ctx));
}

export function respuestaPrevia(req: Request): Response {
  return new Response(null, { status: 204, headers: cabecerasCors(req) });
}
