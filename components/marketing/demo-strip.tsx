import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTemplate } from "@/lib/templates/store";
import { TemplateCard } from "./template-card";

// Featured templates on the marketing landing page. We pick one per family
// (technical-minimal / editorial / commerce) so visitors immediately see
// breadth. Full gallery at /templates.
const FEATURED_IDS = ["mirror", "manuscript", "counter"] as const;

export async function DemoStrip() {
  const fetched = await Promise.all(
    FEATURED_IDS.map((id) => getTemplate(id)),
  );
  const featured = fetched.filter(
    (t): t is NonNullable<typeof t> => t !== null,
  );

  return (
    <section
      id="templates"
      className="relative border-y border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950"
    >
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-medium text-coral-700 dark:text-coral-400 mb-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-coral-500 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-coral-500" />
              </span>
              15 TEMPLATES CURADAS — todas listas para publicar
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              Templates de verdad.
              <br className="sm:hidden" />
              <span className="text-zinc-500 dark:text-zinc-400"> Pickeás, llenás, publicás.</span>
            </h2>
          </div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">
            Cada template es HTML estático, optimizado, listo para tu subdominio
            en `openlen.com`. Pickeá una, llenala con tu info, deployá.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
          {featured.map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center">
          <Link
            href="/templates"
            className="inline-flex items-center gap-1.5 rounded-full ring-1 ring-zinc-300 dark:ring-zinc-700 hover:ring-zinc-900 dark:hover:ring-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 transition"
          >
            Ver los 15 templates
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
