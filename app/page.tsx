import { Hero } from "@/components/marketing/hero";
import { DemoStrip } from "@/components/marketing/demo-strip";
import { Features } from "@/components/marketing/features";
import { Comparison } from "@/components/marketing/comparison";
import { Pricing } from "@/components/marketing/pricing";
import { FinalCta } from "@/components/marketing/final-cta";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";

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
