import { Code, Heart, Image, Unlock, Wallet, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface FeatureItem {
  icon: LucideIcon;
  title: string;
  body: string;
}

const items: FeatureItem[] = [
  {
    icon: Unlock,
    title: "Open source (AGPL)",
    body: "Fork it. Audit it. Run it on your laptop. The whole generator is on GitHub — no SaaS lock-in disguised as a free tier.",
  },
  {
    icon: Wallet,
    title: "10× cheaper than Lovable",
    body: "$19/month flat. No per-page fees, no per-message limits, no surprise overage bills at the end of the quarter.",
  },
  {
    icon: Code,
    title: "Code you own — deploy anywhere",
    body: "Pure Next.js + Tailwind output. Push to Vercel, Netlify, Cloudflare, your own server. We don't host your page.",
  },
  {
    icon: Image,
    title: "Beautiful by default",
    body: "shadcn/ui components + FLUX.2 HD generated imagery. Looks like a $5k freelance job, ships in under a minute.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="max-w-2xl">
          <Badge tone="coral">
            <Heart size={11} /> Why Inari
          </Badge>
          <h2 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-tightest leading-[1.05]">
            Built for people who&apos;d rather{" "}
            <span className="text-zinc-500 dark:text-zinc-500">own software</span> than
            rent it.
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-zinc-200 dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-800 rounded-2xl overflow-hidden">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <div
                key={it.title}
                className="group relative bg-white dark:bg-[#0a0a0a] p-7 sm:p-8 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-950"
              >
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-coral-50 text-coral-600 dark:bg-coral-500/10 dark:text-coral-400 ring-1 ring-coral-200/60 dark:ring-coral-500/20">
                  <Icon size={18} strokeWidth={2} />
                </div>
                <h3 className="mt-5 text-[15px] font-semibold tracking-tight">
                  {it.title}
                </h3>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {it.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
