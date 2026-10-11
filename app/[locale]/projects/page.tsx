import { redirect } from "@/i18n/navigation";

// /projects now lives inside the workspace as a section. Keep the URL working
// (bookmarks, old links) by redirecting to /new with the Pages section open.
//
// La consulta va con la redirección: aquí vuelve el cobro de Polar
// (`?billing_error=<código>` si falló, `?upgraded=<plan>` si se pagó) y quien
// pinta el aviso es la lista. Sin ella el aviso no salía nunca: sólo se veía
// «…_failed» un instante en la barra antes de acabar en el taller (11/10).
export default async function ProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key === "view" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  query.set("view", "projects");
  redirect({ href: `/new?${query}`, locale });
}
