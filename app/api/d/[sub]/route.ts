// /api/d/<almacén> — la MISMA API de datos, sin el subdominio en la URL.
//
// POR QUÉ, medido el 2026-09-18: la forma `/api/d/<sub>/<almacén>` obliga a la
// página a saber con qué subdominio se va a publicar, y un borrador no lo sabe.
// En producción, Len escribió `/api/d/carrito/carrito` —«carrito» en el hueco
// del subdominio— y el carrito no guardó nada. En la medición siguiente, sin
// pedírselo, 2 de 2 carritos escribieron `/api/d/carrito`, que esta ruta no
// tenía y contestaba 404.
//
// El subdominio sale del host de la propia petición (`subDeLaPagina`): una
// página sólo puede nombrarse a sí misma. Todo lo demás —origen, permisos,
// cuota, límite por IP— lo decide la ruta de siempre, a la que esto delega sin
// tocar nada: dos rutas con sus propias reglas serían dos sitios donde
// equivocarse con los permisos.
//
// ⚠️ EL NOMBRE DEL PARÁMETRO MIENTE, y no se puede evitar: Next exige el mismo
// nombre de tramo dinámico en el mismo nivel, y el de al lado ya es `[sub]`.
// Aquí ese único tramo ES EL ALMACÉN.

import {
  publishedBaseHosts,
  resolveCustomDomainSub,
  subDeLaPagina,
} from "@/lib/publish/request-origin";

import {
  DELETE as borrarConSub,
  GET as leerConSub,
  PATCH as modificarConSub,
  POST as escribirConSub,
} from "./[store]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContextoDeRuta = { params: Promise<{ sub: string }> };
type Verbo = (req: Request, ctx: { params: Promise<{ sub: string; store: string }> }) => Promise<Response>;

async function conLaPaginaQueLlama(req: Request, { params }: ContextoDeRuta, verbo: Verbo): Promise<Response> {
  const { sub: store } = await params;
  const sub = await subDeLaPagina({
    headers: req.headers,
    baseHost: publishedBaseHosts(),
    resolveCustomDomain: resolveCustomDomainSub,
  });
  if (!sub) {
    // Sin página publicada detrás no hay a qué proyecto escribirle. Mismo
    // código que la otra ruta da a un subdominio que no existe.
    return new Response(JSON.stringify({ error: "sitio_desconocido" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  return verbo(req, { params: Promise.resolve({ sub, store }) });
}

export function GET(req: Request, ctx: ContextoDeRuta): Promise<Response> {
  return conLaPaginaQueLlama(req, ctx, leerConSub);
}

export function POST(req: Request, ctx: ContextoDeRuta): Promise<Response> {
  return conLaPaginaQueLlama(req, ctx, escribirConSub);
}

export function PATCH(req: Request, ctx: ContextoDeRuta): Promise<Response> {
  return conLaPaginaQueLlama(req, ctx, modificarConSub);
}

export function DELETE(req: Request, ctx: ContextoDeRuta): Promise<Response> {
  return conLaPaginaQueLlama(req, ctx, borrarConSub);
}
