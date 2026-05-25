import type { Metadata } from "next";
import { listTemplates } from "@/lib/templates/store";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { TemplatesGallery } from "@/components/marketing/templates-gallery";
import type { TemplateCardData } from "@/components/marketing/template-card";

// Gallery content changes whenever the admin adds/edits/archives a template.
// Static prerender would cache the count at build time, so we render on
// demand. The DB query is one SELECT against indexed (status, family) and
// completes well under 50ms — acceptable TTFB for a page hit once per session.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Templates | OpenLen",
  description:
    "Hand-built landing page templates for SaaS, devtools, ecommerce, restaurants, editorial brands, creators, and more. Static HTML, optimized, ready to publish to your openlen.com subdomain.",
  openGraph: {
    title: "Templates | OpenLen",
    description:
      "Hand-built templates ready to fill with your info and publish.",
    type: "website",
    url: "https://openlen.com/templates",
  },
  twitter: {
    card: "summary_large_image",
    title: "Templates | OpenLen",
    description:
      "Hand-built templates for SaaS, ecommerce, creators, and more.",
  },
  alternates: {
    canonical: "https://openlen.com/templates",
  },
};

export default async function TemplatesPage() {
  const all = await listTemplates();
  // Slim the DB rows down to what the gallery cards need — keeps the
  // serialized props payload sent to the client small. thumbnailUrl is
  // critical: without it, every card falls back to a live iframe, which
  // ships ~300KB of Tailwind CDN per card (165 cards = 50MB+ per page).
  const cards: TemplateCardData[] = all.map((t) => ({
    id: t.id,
    name: t.name,
    family: t.family,
    accent: t.accent,
    pitch: t.pitch,
    storageUrl: t.storageUrl,
    thumbnailUrl: t.thumbnailUrl,
    featured: t.featured,
  }));

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
              {all.length} HAND-BUILT TEMPLATES
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight max-w-3xl">
              Landing pages built by hand. Ready to make yours.
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl">
              Static HTML, optimized. Pick one, fill it with your info, deploy
              to your subdomain in one click.
            </p>
          </div>
        </section>

        {/* Search bar + filtered gallery (client component owns state) */}
        <TemplatesGallery templates={cards} />

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
