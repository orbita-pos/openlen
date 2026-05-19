import type { Metadata } from "next";
import {
  TEMPLATE_FAMILY_META,
  TEMPLATES,
  type TemplateFamily,
} from "@/components/templates/_registry";
import { TemplateCard } from "@/components/marketing/template-card";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";

export const metadata: Metadata = {
  title: "Templates de landing pages curados | OpenLen",
  description:
    "15 templates de landing pages diseñadas a mano para SaaS, devtools, ecommerce, restaurantes, blogs editoriales. HTML estático, optimizado, listo para publicar en tu subdominio openlen.com.",
  openGraph: {
    title: "Templates de landing pages | OpenLen",
    description:
      "15 templates curadas, listas para llenar con tu info y publicar.",
    type: "website",
    url: "https://openlen.com/templates",
  },
  twitter: {
    card: "summary_large_image",
    title: "Templates de landing pages | OpenLen",
    description:
      "15 templates curadas para SaaS, ecommerce, restaurantes, blogs.",
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

export default function TemplatesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950">
      <MarketingChrome>
        {/* Hero */}
        <section className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-coral-700 dark:text-coral-400 mb-3">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-coral-500 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-coral-500" />
              </span>
              {TEMPLATES.length} TEMPLATES CURADAS
            </div>
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight max-w-3xl">
              Landing pages diseñadas a mano. Listas para hacerlas tuyas.
            </h1>
            <p className="mt-4 text-base sm:text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl">
              Cada template es HTML estático, optimizado, con su propio sistema
              de diseño coherente. Pickeá una, llenala con tu info via AI o
              chat, deployá a tu subdominio en un click.
            </p>
          </div>
        </section>

        {/* Templates by family */}
        <div className="mx-auto max-w-6xl px-6 py-16 space-y-20">
          {FAMILIES.map((family) => {
            const meta = TEMPLATE_FAMILY_META[family];
            const templates = TEMPLATES.filter((t) => t.family === family);
            if (templates.length === 0) return null;
            return (
              <section key={family} id={family}>
                <div className="mb-8 flex items-baseline justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                      {meta.label}
                    </h2>
                    <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-500 max-w-md">
                      {meta.tagline}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-medium">
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
              numberOfItems: TEMPLATES.length,
              itemListElement: TEMPLATES.map((t, i) => ({
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
