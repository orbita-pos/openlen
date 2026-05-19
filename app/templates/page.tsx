import type { Metadata } from "next";
import {
  TEMPLATE_FAMILY_META,
  listTemplates,
  type TemplateFamily,
} from "@/lib/templates/store";
import { TemplateCard } from "@/components/marketing/template-card";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";

export const metadata: Metadata = {
  title: "Templates de landing pages curados | OpenLen",
  description:
    "Templates de landing pages diseñadas a mano para SaaS, devtools, ecommerce, restaurantes, blogs editoriales. HTML estático, optimizado, listo para publicar en tu subdominio openlen.com.",
  openGraph: {
    title: "Templates de landing pages | OpenLen",
    description:
      "Templates curadas, listas para llenar con tu info y publicar.",
    type: "website",
    url: "https://openlen.com/templates",
  },
  twitter: {
    card: "summary_large_image",
    title: "Templates de landing pages | OpenLen",
    description:
      "Templates curadas para SaaS, ecommerce, restaurantes, blogs.",
  },
  alternates: {
    canonical: "https://openlen.com/templates",
  },
};

const FAMILIES: TemplateFamily[] = [
  "technical-minimal",
  "editorial",
  "commerce",
];

export default async function TemplatesPage() {
  const all = await listTemplates();

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950">
      <MarketingChrome>
        {/* Hero — compact: small eyebrow + tight headline + 1-line lede */}
        <section className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto max-w-6xl px-6 py-8 sm:py-10">
            <div className="inline-flex items-center gap-2 text-[11px] font-medium text-coral-700 dark:text-coral-400 mb-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-coral-500 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-coral-500" />
              </span>
              {all.length} TEMPLATES CURADAS
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight max-w-3xl">
              Landing pages diseñadas a mano. Listas para hacerlas tuyas.
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl">
              HTML estático, optimizado. Pickeá una, llenala con tu info, deployá a tu subdominio en un click.
            </p>
          </div>
        </section>

        {/* Templates by family */}
        <div className="mx-auto max-w-6xl px-6 py-10 sm:py-12 space-y-14">
          {FAMILIES.map((family) => {
            const meta = TEMPLATE_FAMILY_META[family];
            const templates = all.filter((t) => t.family === family);
            if (templates.length === 0) return null;
            return (
              <section key={family} id={family}>
                <div className="mb-8 flex items-baseline justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                      {meta.label}
                    </h2>
                    <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
                      {meta.tagline}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-400 dark:text-zinc-400 uppercase tracking-wider font-medium">
                    {templates.length}{" "}
                    {templates.length === 1 ? "template" : "templates"}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                  {templates.map((t) => (
                    <TemplateCard key={t.id} template={t} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/* Schema.org structured data — helps search engines understand
            this is a catalog of software products. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "ItemList",
              name: "OpenLen Templates",
              description:
                "Curated landing page templates for SaaS, devtools, ecommerce, restaurants, and editorial brands.",
              numberOfItems: all.length,
              itemListElement: all.map((t, i) => ({
                "@type": "ListItem",
                position: i + 1,
                url: `https://openlen.com/templates/${t.id}`,
                name: t.name,
                description: t.pitch,
              })),
            }),
          }}
        />
      </MarketingChrome>
    </div>
  );
}
