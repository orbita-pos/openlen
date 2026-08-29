// Datos libres — el endpoint público. Una página publicada escribe y lee aquí.
//
// ESTA RUTA NO DECIDE NADA. Es una cáscara: comprueba de dónde viene, quién
// pregunta, qué permite la declaración de la página y si cabe. Cada una de esas
// cuatro cosas vive en su módulo, probada sin red y sin base. Aquí sólo se
// encadenan y se traducen a códigos HTTP.
//
// Hermana de /api/f/[sub] (formularios), por el mismo motivo: una página
// estática que necesita el servidor para una cosa concreta.

import {
  checkSubdomainOrigin,
  publishedBaseHosts,
  resolveCustomDomainSub,
} from "@/lib/publish/request-origin";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getSubdomainOwner } from "@/lib/projects";
import { checkAndConsume, getClientIp, ipLimitKey } from "@/lib/limits";
import type { AlmacenDeclarado } from "@/lib/page-data/declaracion";
import { validaDocumento } from "@/lib/page-data/declaracion";
import { declaracionPublicada } from "@/lib/page-data/publicada";
import { permite, type Actor } from "@/lib/page-data/permisos";
import { bytesDe, cabe } from "@/lib/page-data/cuota";
import { borrar, bytesUsados, escribir, listar } from "@/lib/page-data/store";
import {
  COOKIE_VISITANTE,
  nuevoVisitante,
  verificaVisitante,
} from "@/lib/page-data/visitante";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINUTO = 60 * 1000;
/** Escrituras por IP y minuto. Generoso para una persona, corto para un bucle.
 *  La cuota limita CUÁNTO se guarda; esto limita cuántas veces lo intentan —
 *  con la cuota llena, cada intento sigue tocando Node y Postgres. */
const MAX_POR_MINUTO = 30;

function json(cuerpo: unknown, status: number, cookie?: string): Response {
  const h = new Headers({ "content-type": "application/json" });
  if (cookie) h.append("set-cookie", cookie);
  return new Response(JSON.stringify(cuerpo), { status, headers: h });
}

function secreto(): string | null {
  // Sin secreto no se firma nada, y una cookie sin firmar es una cookie
  // falsificable: cualquiera se pone el id de otro y le lee el carrito.
  return process.env.OPENLEN_INTERNAL_SECRET?.trim() || null;
}

function cookieDe(req: Request): string | undefined {
  const crudo = req.headers.get("cookie") ?? "";
  for (const parte of crudo.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === COOKIE_VISITANTE) return v.join("=");
  }
  return undefined;
}

function cabeceraCookie(valor: string, sub: string): string {
  const host = process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com";
  return `${COOKIE_VISITANTE}=${valor}; Path=/; Max-Age=63072000; HttpOnly; Secure; SameSite=Lax; Domain=${sub}.${host}`;
}

interface Contexto {
  projectId: string;
  almacen: AlmacenDeclarado;
  actor: Actor;
  visitorId: string;
  cookieNueva?: string;
  plan: "free" | "pro";
}

/** Todo lo común a los cuatro verbos. Devuelve una Response cuando hay que
 *  cortar, o el contexto cuando se puede seguir. */
async function preparar(
  req: Request,
  sub: string,
  store: string,
): Promise<Response | Contexto> {
  const clave = secreto();
  if (!clave) return json({ error: "no_configurado" }, 500);

  // ¿Viene esta petición de la página de ESTE proyecto? Sin esto, cambiar el
  // `sub` de la URL escribe en la base de otro. Misma llamada exacta que
  // /api/f/[sub] — incluido `publishedBaseHosts()`, que acepta VARIOS dominios
  // porque comprobar sólo uno convierte al otro en un agujero.
  const procedencia = await checkSubdomainOrigin({
    headers: req.headers,
    targetSub: sub,
    baseHost: publishedBaseHosts(),
    resolveCustomDomain: resolveCustomDomainSub,
  });
  if (procedencia.kind === "mismatch") {
    return json({ error: "origen_invalido" }, 403);
  }

  const dueño = await getSubdomainOwner(sub);
  if (!dueño) return json({ error: "sitio_desconocido" }, 404);

  const declaracion = await declaracionPublicada(dueño.projectId);
  const almacen = declaracion[store];
  if (!almacen) return json({ error: "almacen_no_declarado" }, 404);

  // El plan del dueño decide la cuota. `getSubdomainOwner` devuelve
  // { userId, projectId } y NO el plan, así que se lee aquí en vez de ampliar
  // esa función — la usan otras rutas que no lo necesitan.
  const [usuario] = await db
    .select({ plan: schema.users.plan })
    .from(schema.users)
    .where(eq(schema.users.id, dueño.userId))
    .limit(1);

  // El visitante: su cookie si la trae y es nuestra, una nueva si no.
  let visitorId = verificaVisitante(cookieDe(req), clave);
  let cookieNueva: string | undefined;
  if (!visitorId) {
    const emitida = nuevoVisitante(clave);
    visitorId = verificaVisitante(emitida, clave)!;
    cookieNueva = cabeceraCookie(emitida, sub);
  }

  return {
    projectId: dueño.projectId,
    almacen,
    actor: { tipo: "visitante", id: visitorId },
    visitorId,
    cookieNueva,
    plan: usuario?.plan === "pro" ? "pro" : "free",
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string; store: string }> },
): Promise<Response> {
  const { sub, store } = await params;
  const ctx = await preparar(req, sub, store);
  if (ctx instanceof Response) return ctx;

  const alcance = permite(ctx.almacen.modo, ctx.actor, "leer");
  if (alcance === "ninguno") return json({ error: "no_permitido" }, 403);

  const documentos = await listar({
    projectId: ctx.projectId,
    store,
    alcance,
    visitorId: ctx.visitorId,
  });
  return json({ ok: true, documentos }, 200, ctx.cookieNueva);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string; store: string }> },
): Promise<Response> {
  const { sub, store } = await params;

  const permitido = await checkAndConsume(ipLimitKey(getClientIp(req), "page-data"), [
    { windowMs: MINUTO, max: MAX_POR_MINUTO, label: "minuto" },
  ]);
  if (!permitido.ok) return json({ error: "demasiadas_peticiones" }, 429);

  const ctx = await preparar(req, sub, store);
  if (ctx instanceof Response) return ctx;

  if (permite(ctx.almacen.modo, ctx.actor, "crear") === "ninguno") {
    return json({ error: "no_permitido" }, 403);
  }

  let crudo: unknown;
  try {
    crudo = await req.json();
  } catch {
    return json({ error: "documento_invalido" }, 422);
  }

  const validado = validaDocumento(ctx.almacen, crudo);
  if (!validado.ok) return json({ error: validado.razon }, 422);

  // En `propio` hay UN documento por visitante: se reemplaza, no se acumula.
  // Sin esto, cada cambio del carrito deja una fila y la cuota se agota sola.
  let reemplazaId: string | undefined;
  let salientes = 0;
  if (ctx.almacen.modo === "propio") {
    const mios = await listar({
      projectId: ctx.projectId,
      store,
      alcance: "propios",
      visitorId: ctx.visitorId,
    });
    if (mios[0]) {
      reemplazaId = mios[0].id;
      salientes = bytesDe(mios[0].doc);
    }
  }

  const veredicto = cabe({
    plan: ctx.plan,
    usados: await bytesUsados(ctx.projectId),
    entrantes: bytesDe(validado.doc),
    salientes,
  });
  if (!veredicto.ok) {
    // 413 el documento solo, 507 el proyecto entero. Son cosas distintas para
    // quien escribe el JS: una se arregla mandando menos, la otra no.
    const status = veredicto.razon === "documento_grande" ? 413 : /* cuota_llena */ 507;
    return json({ error: veredicto.razon }, status);
  }

  const documento = await escribir({
    projectId: ctx.projectId,
    store,
    visitorId: ctx.visitorId,
    doc: validado.doc,
    caducaDias: ctx.almacen.caducaDias,
    reemplazaId,
  });
  return json({ ok: true, documento }, 200, ctx.cookieNueva);
}

export async function PATCH(
  req: Request,
  ctxRuta: { params: Promise<{ sub: string; store: string }> },
): Promise<Response> {
  // Modificar es reemplazar: en `propio` sólo hay un documento por visitante,
  // así que POST ya hace exactamente esto. Tener dos caminos para una operación
  // es tener dos sitios donde equivocarse con los permisos.
  return POST(req, ctxRuta);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ sub: string; store: string }> },
): Promise<Response> {
  const { sub, store } = await params;
  const ctx = await preparar(req, sub, store);
  if (ctx instanceof Response) return ctx;

  const alcance = permite(ctx.almacen.modo, ctx.actor, "borrar");
  if (alcance === "ninguno") return json({ error: "no_permitido" }, 403);

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "falta_id" }, 422);

  const hecho = await borrar({
    projectId: ctx.projectId,
    store,
    id,
    alcance,
    visitorId: ctx.visitorId,
  });
  return json({ ok: hecho }, hecho ? 200 : 404, ctx.cookieNueva);
}
