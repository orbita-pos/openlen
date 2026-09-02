import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

import { internalSecretOk } from "@/lib/publish/internal-auth";
import { findTemplateHtmlIssue } from "@/lib/templates/admin-schemas";
import { getTemplate, upsertTemplate } from "@/lib/templates/store";
import {
  planificarRepublicacion,
  seleccionar,
  type FilaDeGaleria,
  type PlantillaEnDisco,
} from "@/lib/templates/republicar-desde-disco";

// Republica en la galería las plantillas cuyo HTML fuente ha dejado de coincidir
// con lo que sirve R2. Disparado a mano con curl desde la caja, NO expuesto
// públicamente.
//
// CORRE EN PROCESO, igual que /api/internal/live-republish y por el mismo
// motivo: `upsertTemplate` → `findTemplateHtmlIssue` → `sanitizeForPublish`
// arrastra los crates nativos (.node), que esbuild no puede empaquetar en un
// .mjs standalone (ver scripts/build-cron.mjs). Aquí el server ya los tiene
// cargados. Y de paso resuelve el otro problema: el entorno es el de
// producción, así que la base y el bucket son los de verdad — desde el portátil
// de Jesús no lo son, y republicar allí escribe en su Postgres local y en su
// disco mientras imprime «ok».
//
// LA AUTENTICACIÓN NO PUEDE SER `requireAdmin`: es de SESIÓN (auth() +
// users.role), así que no se puede automatizar sin una cookie. `x-internal-secret`
// es el mismo mecanismo que systemd ya usa para el timer de datos vivos.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // 19 subidas a R2 + 19 upserts

/** Dónde deja el deploy las fuentes. Ver el paso 3 de infra/scripts/deploy.ps1. */
const DIR_POR_DEFECTO = "templates-starter";

/**
 * SIN `.preview.html`. Son la vista previa, no el cuerpo publicable, y son
 * justo donde viven los `onerror` que quedan (dentro de cadenas JS que las
 * arman en tiempo de ejecución). Subir una como si fuera el cuerpo cambiaría la
 * plantilla por otra cosa.
 */
function esFuentePublicable(nombre: string): boolean {
  return nombre.endsWith(".html") && !nombre.endsWith(".preview.html");
}

export async function POST(req: Request) {
  if (!internalSecretOk(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: { aplicar?: boolean; ids?: string[] } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Sin cuerpo = en seco. Un curl sin `-d` es lo que se teclea primero.
  }
  const aplicar = body.aplicar === true;
  const idsPedidos = Array.isArray(body.ids) ? body.ids : undefined;

  const dir = join(process.cwd(), process.env.OPENLEN_TEMPLATES_DIR ?? DIR_POR_DEFECTO);

  let nombres: string[];
  try {
    nombres = (await readdir(dir)).filter(esFuentePublicable);
  } catch {
    return NextResponse.json(
      { ok: false, error: "sin_fuentes", dir, pista: "el deploy no copió templates-starter/" },
      { status: 500 },
    );
  }

  const disco: PlantillaEnDisco[] = [];
  for (const n of nombres) {
    disco.push({ id: n.replace(/\.html$/, ""), html: await readFile(join(dir, n), "utf8") });
  }

  // La galería se consulta SÓLO por los ids que hay en disco: es el conjunto
  // que nos importa, sirve para cualquier estado (no sólo `published`) y de
  // paso trae el registro entero, que hace falta para el merge de abajo. Por
  // eso `soloEnGaleria` sale siempre vacío aquí — no es un hallazgo, es que no
  // se preguntó.
  const registros = new Map(
    (await Promise.all(disco.map((p) => getTemplate(p.id)))).flatMap((r) => (r ? [[r.id, r] as const] : [])),
  );
  const galeria: FilaDeGaleria[] = [...registros.values()].map((r) => ({
    id: r.id,
    contentHash: r.contentHash,
  }));

  const plan = planificarRepublicacion(disco, galeria);
  const { republicar, ignorados, desconocidos } = seleccionar(plan, idsPedidos);

  // EN SECO POR DEFECTO. Esto escribe en la galería de producción; que haga
  // falta pedirlo dos veces es la diferencia entre una herramienta y un
  // accidente.
  if (!aplicar) {
    return NextResponse.json({
      ok: true,
      seco: true,
      dir,
      enDisco: disco.length,
      cambiadas: plan.cambiadas,
      iguales: plan.iguales.length,
      soloEnDisco: plan.soloEnDisco,
      seRepublicarian: republicar.map((r) => r.id),
      ignorados,
      desconocidos,
      comoAplicar: 'repite el curl con -d \'{"aplicar":true}\'',
    });
  }

  const htmlPorId = new Map(disco.map((p) => [p.id, p.html]));
  const hechas: Array<{ id: string; contentHash: string; storageUrl: string }> = [];
  const fallidas: Array<{ id: string; error: string }> = [];

  for (const { id } of republicar) {
    const existente = registros.get(id);
    const html = htmlPorId.get(id);
    if (!existente || html === undefined) {
      fallidas.push({ id, error: "desapareció entre el plan y la escritura" });
      continue;
    }

    // El MISMO validador que el POST, el PUT y la CLI. Rechaza, no sanea: la
    // copia cruda en R2 es la que se puede re-derivar.
    const issue = findTemplateHtmlIssue({ html });
    if (issue) {
      fallidas.push({ id, error: `html_invalido: ${issue.where} — ${issue.reason}` });
      continue;
    }

    try {
      const record = await upsertTemplate({
        id: existente.id,
        name: existente.name,
        family: existente.family,
        accent: existente.accent,
        pitch: existente.pitch,
        description: existente.description,
        mode: existente.mode,
        html,
        visualMetadata: existente.visualMetadata,
        // `upsert` SIEMPRE escribe la columna `pages`, así que omitirla dejaría
        // una plantilla multipágina reducida a su portada. Mismo cuidado que en
        // app/api/admin/templates/[id]/route.ts.
        pages: existente.pages,
        status: existente.status,
      });
      hechas.push({ id, contentHash: record.contentHash, storageUrl: record.storageUrl });
    } catch (e) {
      // Una que falla no para a las demás: dejar 18 sin republicar porque la 19
      // tropezó es peor que republicar 18 y decir cuál falló.
      fallidas.push({ id, error: (e as Error).message.slice(0, 200) });
    }
  }

  return NextResponse.json({
    ok: fallidas.length === 0,
    seco: false,
    republicadas: hechas.length,
    hechas,
    fallidas,
    ignorados,
    desconocidos,
  });
}
