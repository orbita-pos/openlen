import { OG_IMAGE } from "@/lib/seo/og-image";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { Pricing } from "@/components/marketing/pricing";
import { FinalCta } from "@/components/marketing/final-cta";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "marketing" });
  const title = t("pages.pricing.title");
  const description = t("pages.pricing.description");
  const url = `${SITE_URL}/${locale}/pricing`;
  return {
    // `absolute`: the layout's «%s | OpenLen» would repeat the brand the title already leads with.
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: "OpenLen", title, description, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE] },
  };
}

// PRICING, ITS OWN PAGE (spec local 2026-11-06-portada-solo-input): it was a section of the home until 06/11. The block
// opens with its own big title, so the page's H1 is for screen readers and search engines only — a visible one above
// it would be two titles in a row.
export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "marketing" });
  return (
    <div className="relative min-h-screen flex flex-col overflow-x-clip">
      <MarketingChrome>
        <h1 className="sr-only">{t("pages.pricing.heading")}</h1>
        <Pricing />
        <FinalCta />
      </MarketingChrome>
    </div>
  );
}
