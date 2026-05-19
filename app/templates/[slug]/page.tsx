import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  TEMPLATE_FAMILY_META,
  TEMPLATES,
  getTemplate,
} from "@/components/templates/_registry";
import { TemplateCard } from "@/components/marketing/template-card";
import { UseTemplateButton } from "@/components/marketing/use-template-button";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return TEMPLATES.map((t) => ({ slug: t.id }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = getTemplate(slug);
  if (!t) {
    return { title: "Template not found | OpenLen" };
  }
  const familyLabel = TEMPLATE_FAMILY_META[t.family].label;
  return {
    title: `${t.name} — Template ${familyLabel.toLowerCase()} | OpenLen`,
    description: `${t.pitch} — ${t.description}. Template gratuita lista para publicar en tu subdominio openlen.com.`,
    openGraph: {
      title: `${t.name} — Template para ${familyLabel}`,
      description: t.pitch,
      type: "website",
      url: `https://openlen.com/templates/${t.id}`,
    },
    twitter: {
      card: "summary_large_image",
      title: `${t.name} | OpenLen`,
      description: t.pitch,
    },
    alternates: {
      canonical: `https://openlen.com/templates/${t.id}`,
    },
  };
}

export default async function TemplateDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const template = getTemplate(slug);
  if (!template) notFound();

  const family = TEMPLATE_FAMILY_META[template.family];
  const related = TEMPLATES.filter(
    (t) => t.family === template.family && t.id !== template.id,
  ).slice(0, 3);

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950">
      <MarketingChrome>
        {/* Breadcrumb + back link */}
        <div className="mx-auto max-w-6xl px-6 pt-6 sm:pt-8">
          <Link
            href="/templates"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
          >
            <ArrowLeft size={12} />
            Todos los templates
          </Link>
        </div>

        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 py-6 sm:py-8">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6 lg:gap-10 items-start">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: template.accent }}
                  aria-hidden
                />
                <span className="text-[10.5px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 font-medium">
                  {family.label}
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                {template.name}
              </h1>
              <p className="mt-2 text-base sm:text-lg text-zinc-700 dark:text-zinc-300 leading-snug">
                {template.pitch}
              </p>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500 leading-relaxed">
                {template.description}
              </p>

              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <UseTemplateButton templateId={template.id} />
                <a
                  href={`/templates/curated/${template.fileName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-full ring-1 ring-zinc-300 dark:ring-zinc-700 hover:ring-zinc-900 dark:hover:ring-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 transition"
                >
                  Ver template en vivo
                </a>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-[10.5px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-medium mb-1">
                    Familia
                  </dt>
                  <dd className="text-zinc-900 dark:text-zinc-100">
                    {family.label}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10.5px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-medium mb-1">
                    Modo
                  </dt>
                  <dd className="text-zinc-900 dark:text-zinc-100 capitalize">
                    {template.mode}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10.5px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-medium mb-1">
                    Color accent
                  </dt>
                  <dd className="text-zinc-900 dark:text-zinc-100 inline-flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-3 rounded-sm ring-1 ring-zinc-300 dark:ring-zinc-700"
                      style={{ background: template.accent }}
                      aria-hidden
                    />
                    <code className="text-xs">{template.accent}</code>
                  </dd>
                </div>
                <div>
                  <dt className="text-[10.5px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-medium mb-1">
                    Formato
                  </dt>
                  <dd className="text-zinc-900 dark:text-zinc-100">
                    HTML estático
                  </dd>
                </div>
              </dl>
            </div>

            {/* Preview */}
            <div className="lg:sticky lg:top-24">
              <TemplateCard template={template} />
            </div>
          </div>
        </section>

        {/* Related templates from same family */}
        {related.length > 0 && (
          <section className="mx-auto max-w-6xl px-6 py-10 sm:py-12 border-t border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-2">
              Más de {family.label}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-500 mb-8">
              {family.tagline}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
              {related.map((t) => (
                <TemplateCard key={t.id} template={t} />
              ))}
            </div>
          </section>
        )}

        {/* Schema.org structured data — SoftwareApplication for this template. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "CreativeWork",
              name: template.name,
              description: template.description,
              url: `https://openlen.com/templates/${template.id}`,
              about: {
                "@type": "Thing",
                name: family.label,
              },
              isPartOf: {
                "@type": "ItemList",
                name: "OpenLen Templates",
                url: "https://openlen.com/templates",
              },
            }),
          }}
        />
      </MarketingChrome>
    </div>
  );
}
