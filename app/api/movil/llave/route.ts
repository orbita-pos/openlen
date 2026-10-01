// La llave del teléfono: POST canjea el código de un solo uso (lo da
// /<idioma>/movil/entrar) por la llave; DELETE la borra («Salir»).
import { borrarLlave, canjearCodigo } from "@/lib/movil/llaves";
import { estadoValido, llaveDeLaCabecera } from "@/lib/movil/secreto";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODIGO = /^[A-Za-z0-9_-]{43}$/;

export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  let b: { codigo?: unknown; estado?: unknown; nombre?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "datos" }, { status: 400 });
  }
  if (typeof b.codigo !== "string" || !CODIGO.test(b.codigo) || !estadoValido(b.estado)) {
    return Response.json({ error: "datos" }, { status: 400 });
  }
  const nombre = typeof b.nombre === "string" ? b.nombre : null;
  const r = await canjearCodigo(b.codigo, b.estado, nombre);
  if (!r) return Response.json({ error: "codigo_invalido" }, { status: 401 });
  return Response.json({ llave: r.llave });
});

export const DELETE = paraLaApp(async (req: Request): Promise<Response> => {
  const llave = llaveDeLaCabecera(req.headers.get("authorization"));
  if (!llave) return Response.json({ error: "sin_llave" }, { status: 401 });
  await borrarLlave(llave);
  return new Response(null, { status: 204 });
});

export const OPTIONS = respuestaPrevia;
