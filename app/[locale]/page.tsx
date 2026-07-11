import type { Metadata } from "next";
import { Hero } from "@/components/marketing/hero";
import { MosaicWall } from "@/components/marketing/mosaic-wall";
import { Features } from "@/components/marketing/features";
import { AnalyticsLeads } from "@/components/marketing/analytics-leads";
import { Comparison } from "@/components/marketing/comparison";
import { Pricing } from "@/components/marketing/pricing";
import { FinalCta } from "@/components/marketing/final-cta";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { countTemplates } from "@/lib/templates/store";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

// Revalidate every 60s. The page reads template thumbnails + counts from
// DB at build time — without ISR, generating new thumbnails via
// `templates:thumbnails` wouldn't propagate to the homepage until the
// next full deploy. 60s gives sub-minute freshness without making every
// visitor pay the SSR cost.
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const es = locale === "es";
  const count = await countTemplates().catch(() => 0);
  // Brand name leads the title — the strongest on-page signal for the
  // branded query "openlen" (the layout's title.template doesn't apply
  // to its own segment, so it must be inline here).
  const title = es
    ? "OpenLen — Landing pages que son tuyas. Hechas con IA. Código abierto."
    : "OpenLen — Landing pages you own. AI-built. Open source.";
  const description = es
    ? `Una mirada abierta a tus landing pages. Creador de código abierto con generación por IA, ${count} plantillas (incluidas 30 link-in-bio para creadores), analítica respetuosa con la privacidad y tu HTML — AGPLv3.`
    : `An open lens on your landing pages. Open-source builder with AI generation, ${count} templates including 30 link-in-bio creator hubs, privacy-first analytics, your HTML — AGPLv3.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/${locale}` },
    openGraph: {
      type: "website",
      locale: es ? "es_ES" : "en_US",
      url: `${SITE_URL}/${locale}`,
      siteName: "OpenLen",
      title,
      description,
      images: ["/og.png"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export default function HomePage() {
  return (
    <div className="relative min-h-screen flex flex-col">
      {/* Dawn atmosphere from the very first pixel — sits behind the sticky
          glass nav so there is no white band above the hero. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[900px] aurora-dawn"
        aria-hidden
      />
      <MarketingChrome>
        <Hero />
        <MosaicWall />
        <Features />
        <AnalyticsLeads />
        <Comparison />
        <Pricing />
        <FinalCta />
      </MarketingChrome>
    </div>
  );
}
