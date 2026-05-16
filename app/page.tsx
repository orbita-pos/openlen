"use client";

import { Nav } from "@/components/marketing/nav";
import { Hero } from "@/components/marketing/hero";
import { DemoStrip } from "@/components/marketing/demo-strip";
import { Features } from "@/components/marketing/features";
import { Comparison } from "@/components/marketing/comparison";
import { Pricing } from "@/components/marketing/pricing";
import { FinalCta } from "@/components/marketing/final-cta";
import { Footer } from "@/components/marketing/footer";
import { useDarkMode } from "@/lib/use-dark-mode";

export default function HomePage() {
  const [dark, toggleDark] = useDarkMode();
  return (
    <div className="min-h-screen flex flex-col">
      <Nav dark={dark} onToggleDark={toggleDark} />
      <main className="flex-1">
        <Hero />
        <DemoStrip />
        <Features />
        <Comparison />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
