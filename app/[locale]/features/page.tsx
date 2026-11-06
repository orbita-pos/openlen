import { OG_IMAGE } from "@/lib/seo/og-image";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { HeroProduct } from "@/components/marketing/hero-product";
import { MosaicWall } from "@/components/marketing/mosaic-wall";
import { AnalyticsLeads } from "@/components/marketing/analytics-leads";
import { ConnectYourAi } from "@/components/marketing/connect-your-ai";
import { Trust } from "@/components/marketing/trust";
import { FinalCta } from "@/components/marketing/final-cta";
import { LenCompanion } from "@/components/marketing/len-companion";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

// The wall reads template thumbnails from the DB: the same 60 s the home had when it lived there.
export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "marketing" });
  const title = t("pages.features.title");
  const description = t("pages.features.description");
  const url = `${SITE_URL}/${locale}/features`;
  return {
    // `absolute`: the layout's «%s | OpenLen» would repeat the brand the title already leads with.
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: "OpenLen", title, description, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE] },
  };
}

// WHAT USED TO BE THE HOME'S SCROLL (spec local 2026-11-06-portada-solo-input): since 06/11 the home is only the input,
// and these blocks live here, unchanged and in the same order. The workshop mockup keeps its `id="features"` wrapper.
// The H1 carries `data-len-hide`, so Len who comes along (bottom right) doesn't show up the moment the page loads.
export default async function FeaturesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "marketing" });
  return (
    <div className="relative min-h-screen flex flex-col overflow-x-clip">
      <MarketingChrome>
        <header className="mx-auto max-w-3xl px-6 pt-16 text-center sm:pt-24">
          <h1
            data-len-hide
            className="text-balance text-4xl font-semibold leading-[1.05] tracking-tightest sm:text-6xl"
          >
            {t("pages.features.heading")}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-[17px] text-zinc-600 dark:text-zinc-400">
            {t("pages.features.subheading")}
          </p>
        </header>
        <div
          id="features"
          data-len-section="taller"
          className="relative mx-auto mt-14 max-w-[88rem] scroll-mt-20 px-6 pb-20 sm:mt-16 sm:pb-24"
        >
          <div className="relative">
            <HeroProduct />
          </div>
        </div>
        <MosaicWall />
        <AnalyticsLeads />
        <ConnectYourAi />
        <Trust />
        <FinalCta />
        <LenCompanion />
      </MarketingChrome>
    </div>
  );
}
