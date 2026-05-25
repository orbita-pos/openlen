import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { listTemplates } from "@/lib/templates/store";
import { TemplateCard } from "./template-card";

// Showcase of the link-in-bio creator family — the differentiator vs
// Linktree-style hosted services. Pulled live from the DB so adding a new
// creator template via `templates:add` makes it eligible to surface here
// without code changes. Order is curated to span personas (streamer →
// musician → photographer → premium → indie maker → VTuber) so visitors
// see breadth at a glance.

const FEATURED_CREATOR_IDS = [
  "bio-phasewalk",
  "bio-matterhorn",
  "bio-clara",
  "bio-maren",
  "bio-marie",
  "bio-lumen",
] as const;

export async function CreatorShowcase() {
  const all = await listTemplates();
  const byId = new Map(all.map((t) => [t.id, t]));
  const featured = FEATURED_CREATOR_IDS.flatMap((id) => {
    const t = byId.get(id);
    return t ? [t] : [];
  });
  const creatorCount = all.filter((t) => t.family === "creator").length;

  // If the DB has fewer than 3 of the featured IDs, the section would
  // look empty — hide it rather than render a sad strip.
  if (featured.length < 3) return null;

  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
          <div>
            <Badge tone="coral">
              <Sparkles size={11} /> For creators
            </Badge>
            <h2 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-tightest leading-[1.05]">
              Link pages you{" "}
              <span className="text-zinc-500 dark:text-zinc-400">actually own.</span>
            </h2>
            <p className="mt-4 max-w-xl text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {creatorCount} hand-built link-in-bio templates for streamers,
              musicians, photographers, indie makers, and premium creators.
              Per-link click tracking + page analytics built in — no Linktree
              tax, no Google Analytics, no cookies.
            </p>
          </div>
          <Link
            href="/templates"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full ring-1 ring-zinc-300 dark:ring-zinc-700 hover:ring-zinc-900 dark:hover:ring-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 transition self-start md:self-end"
          >
            All {creatorCount} creator templates
            <ArrowRight size={14} />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {featured.map((t) => (
            // No priority here — DemoStrip's first card is the LCP image
            // because it sits higher on the page. CreatorShowcase cards
            // are below the fold on most viewports.
            <TemplateCard key={t.id} template={t} />
          ))}
        </div>
      </div>
    </section>
  );
}
