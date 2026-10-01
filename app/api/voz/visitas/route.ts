// Los números de la tarjeta de visitas de la llamada: los de `ver_visitas`, en la
// hora del usuario y con el rango por defecto de la herramienta (últimos 7 días).
// No sale de /api/projects/<id>/insights: ése corta los días en UTC.
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { esDuenoDelProyecto } from "@/lib/voz/dueno";
import { datosDeVisitas } from "@/lib/voz/tarjeta-de-visitas";
import { resumirVisitas } from "@/lib/resultados/visitas";
import { ZONA_SIN_DATO, zonaValida } from "@/lib/resultados/zona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return Response.json({ error: "no_autenticado" }, { status: 401 });
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project") ?? "";
  if (!projectId || !(await esDuenoDelProyecto(projectId, userId))) {
    return Response.json({ error: "proyecto_no_encontrado" }, { status: 404 });
  }
  const zona = zonaValida(url.searchParams.get("zona")) ?? ZONA_SIN_DATO;
  return Response.json(datosDeVisitas(await resumirVisitas(projectId, zona, {})));
});

export const OPTIONS = respuestaPrevia;
