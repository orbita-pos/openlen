import { Hero } from "@/components/marketing/hero";
import { DemoStrip } from "@/components/marketing/demo-strip";
import { Features } from "@/components/marketing/features";
import { Comparison } from "@/components/marketing/comparison";
import { Pricing } from "@/components/marketing/pricing";
import { FinalCta } from "@/components/marketing/final-cta";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";

// Revalidate every 60s. The page reads template thumbnails + counts from
// DB at build time — without ISR, generating new thumbnails via
// `templates:thumbnails` wouldn't propagate to the homepage until the
// next full deploy. 60s gives sub-minute freshness without making every
// visitor pay the SSR cost.
export const revalidate = 60;

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <MarketingChrome>
        <Hero />
        <DemoStrip />
        <Features />
        <Comparison />
        <Pricing />
        <FinalCta />
      </MarketingChrome>
    </div>
  );
}
