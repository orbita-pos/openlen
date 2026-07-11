import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getTemplate, listTemplates } from "@/lib/templates/store";
import { TemplateCard } from "@/components/marketing/template-card";
import { UseTemplateButton } from "@/components/marketing/use-template-button";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";

interface PageProps {
  params: Promise<{ slug: string; locale: string }>;
}

// generateStaticParams() pre-renders the known slugs at build time, but
// dynamicParams=true lets templates added to the DB AFTER a deploy render
// on-demand (so a new template's detail page exists without a redeploy).
// A slug with no published template still 404s via notFound() below.
export const dynamicParams = true;

// Revalidate the static page every minute. Without this, editing a
// template via `templates:add` (which changes its storageUrl content
// hash) doesn't propagate to the detail page until the next full
// deploy. With ISR, the next request after 60s triggers a background
// regeneration that picks up the new DB row.
export const revalidate = 60;

export async function generateStaticParams() {
  const all = await listTemplates();
  return all.map((t) => ({ slug: t.id }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, locale } = await params;
  const t = await getTemplate(slug);
  if (!t || t.status !== "published") {
    return { title: "Template not found" };
  }
  const tf = await getTranslations({ locale, namespace: "families" });
  const familyLabel = tf(`${t.family}.label`);
  return {
    title: `${t.name} — Template ${familyLabel.toLowerCase()}`,
    description: `${t.pitch} — ${t.description}. Template gratuita lista para publicar en tu subdominio openlen.com.`,
    openGraph: {
      title: `${t.name} — Template para ${familyLabel}`,
      description: t.pitch,
      type: "website",
      url: `https://openlen.com/templates/${t.id}`,
      images: ["/og.png"],
    },
    twitter: {
      card: "summary_large_image",
      title: `${t.name} | OpenLen`,
      description: t.pitch,
      images: ["/og.png"],
    },
    alternates: {
      canonical: `https://openlen.com/templates/${t.id}`,
    },
  };
}

export default async function TemplateDetailPage({ params }: PageProps) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages");
  const tf = await getTranslations("families");
  const template = await getTemplate(slug);
  if (!template || template.status !== "published") notFound();

  const all = await listTemplates({ family: template.family });
  const related = all
    .filter((t) => t.id !== template.id)
    .slice(0, 3);

  return (
    <div className="relative min-h-screen flex flex-col bg-white dark:bg-zinc-950">
      {/* The page dresses in the template's own accent — a soft ambient glow
          derived from its brand color instead of a generic backdrop. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{
          background: `radial-gradient(60% 75% at 50% -12%, ${template.accent}24, transparent 65%)`,
        }}
        aria-hidden
      />
      <MarketingChrome>
        {/* Breadcrumb + back link */}
        <div className="mx-auto w-full max-w-6xl px-6 pt-6 sm:pt-8">
          <Link
            href="/templates"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
          >
            <ArrowLeft size={12} />
            {t("templateDetail.backToAll")}
          </Link>
        </div>

        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-8">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-8 lg:gap-12 items-start">
            <div>
              <span
                className="inline-flex items-center gap-2 rounded-full bg-white/70 dark:bg-white/[0.06] backdrop-blur ring-1 ring-zinc-200/70 dark:ring-white/10 px-3 py-1 text-[10.5px] uppercase tracking-wider text-zinc-600 dark:text-zinc-300 font-semibold"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: template.accent }}
                  aria-hidden
                />
                {tf(`${template.family}.label`)}
              </span>
              <h1 className="mt-4 text-4xl sm:text-5xl font-semibold tracking-tightest leading-[1.04]">
                {template.name}
              </h1>
              <span
                className="mt-4 block h-1 w-14 rounded-full"
                style={{ background: template.accent }}
                aria-hidden
              />
              <p className="mt-4 serif-accent text-xl sm:text-2xl text-zinc-700 dark:text-zinc-300 leading-snug">
                {template.pitch}
              </p>
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {template.description}
              </p>

              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <UseTemplateButton templateId={template.id} />
                <a
                  href={template.storageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-full ring-1 ring-zinc-300 dark:ring-zinc-700 hover:ring-zinc-900 dark:hover:ring-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 transition"
                >
                  {t("templateDetail.viewLive")}
                </a>
              </div>

              <dl className="mt-7 grid grid-cols-2 gap-3 text-sm">
                {[
                  [t("templateDetail.meta.family"), tf(`${template.family}.label`), null],
                  [t("templateDetail.meta.mode"), template.mode, "capitalize"],
                  [t("templateDetail.meta.accent"), template.accent, "accent"],
                  [t("templateDetail.meta.format"), t("templateDetail.meta.formatValue"), null],
                ].map(([label, value, kind]) => (
                  <div
                    key={String(label)}
                    className="rounded-2xl bg-white/70 dark:bg-white/[0.04] ring-1 ring-zinc-200/70 dark:ring-white/10 backdrop-blur-sm px-4 py-3"
                  >
                    <dt className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-medium mb-1">
                      {label}
                    </dt>
                    <dd
                      className={`text-zinc-900 dark:text-zinc-100 ${
                        kind === "capitalize" ? "capitalize" : ""
                      } ${kind === "accent" ? "inline-flex items-center gap-1.5" : ""}`}
                    >
                      {kind === "accent" ? (
                        <>
                          <span
                            className="inline-block w-3 h-3 rounded-full ring-1 ring-zinc-300 dark:ring-zinc-700"
                            style={{ background: template.accent }}
                            aria-hidden
                          />
                          <code className="text-xs">{template.accent}</code>
                        </>
                      ) : (
                        value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Preview — browser-framed, scrollable through the FULL page when
                the reference screenshot exists (fallback: the live card). */}
            <div className="lg:sticky lg:top-24">
              <div className="overflow-hidden rounded-2xl ring-1 ring-zinc-200/70 dark:ring-white/10 bg-white dark:bg-zinc-900 shadow-xl shadow-zinc-950/[0.07]">
                <div className="flex items-center gap-1.5 h-8 px-3 border-b border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50/70 dark:bg-zinc-900/70 backdrop-blur-sm">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" aria-hidden />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" aria-hidden />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#28C840]" aria-hidden />
                  <span className="mx-auto inline-flex items-center rounded-full bg-white dark:bg-zinc-950 ring-1 ring-zinc-200/70 dark:ring-white/10 px-3 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                    {template.id}
                    <span style={{ color: template.accent }}>.openlen.com</span>
                  </span>
                </div>
                {template.screenshotUrl ? (
                  <div className="h-[540px] overflow-y-auto overscroll-contain">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={template.screenshotUrl}
                      alt={template.name}
                      className="w-full h-auto"
                      decoding="async"
                    />
                  </div>
                ) : (
                  <TemplateCard template={template} compact />
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Related templates from same family */}
        {related.length > 0 && (
          <section className="mx-auto max-w-6xl px-6 py-10 sm:py-12 border-t border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-2">
              {t("templateDetail.related.heading", { family: tf(`${template.family}.label`) })}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">
              {tf(`${template.family}.tagline`)}
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
                name: tf(`${template.family}.label`),
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
