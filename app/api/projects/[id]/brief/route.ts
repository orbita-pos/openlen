import { auth } from "@/auth";
import { getProject } from "@/lib/projects";

// ─────────────────────────────────────────────────────────────────────────────
// EL BRIEF DEL PROYECTO — leerlo, que hasta hoy no se podía.
//
// `projects.userBrief` se le inyecta al Agente en cada turno como «PROJECT
// BRIEF (persistente — aplica a toda petición)» y lo ESCRIBE
// `recordar_preferencia` con alcance="esta_pagina". Escribir ya se podía
// (`PATCH /api/projects/[id]`); lo que no había era forma de VERLO.
//
// El resultado era la peor combinación posible: un campo que sólo escribe el
// modelo, que sólo lee el modelo, y que manda sobre todas las peticiones del
// usuario sin que él sepa que existe. Y el prompt lo agravaba mandándole a «la
// pestaña Brief» cuando se llenaba — una pestaña que no existe:
// `panels/brief-panel.tsx` y `panels/ai-brief-panel.tsx` tienen los dos CERO
// importadores. (Los tres textos se corrigieron el 2026-09-01.)
//
// POR QUÉ UNA RUTA PROPIA Y NO `GET /api/projects/[id]`: ésa devuelve el
// proyecto ENTERO —el HTML incluido, que son decenas de kilobytes— y el panel
// sólo necesita unas líneas de texto. Y por qué se LEE en vez de enhebrarse
// como prop desde la página: el Agente puede escribirlo a mitad de sesión, que
// es justo cuando el usuario quiere mirarlo; una prop quedaría rancia.
//
// ESCRIBIR SIGUE SIENDO DE `PATCH /api/projects/[id]`, que ya lo hacía. Dos
// escritores del mismo campo es como se separan.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  // `getProject` ya comprueba la propiedad: un proyecto ajeno vuelve null y de
  // aquí sale un 404, igual que en la ruta de al lado.
  const project = await getProject(id, session.user.id);
  if (!project) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ brief: project.userBrief ?? "" });
}
