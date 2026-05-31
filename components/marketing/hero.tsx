import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ArrowRight, Star } from "lucide-react";
import { GithubIcon } from "@/components/ui/brand-icons";
import { countProjectsSince } from "@/lib/projects";
import { HeroPromptInput } from "./hero-prompt-input";

const avatarColors = ["#FF5A36", "#22d3ee", "#a78bfa", "#facc15", "#34d399"];

const REPO_URL = "https://github.com/orbita-pos/openlen";

// Live GitHub star count, cached for an hour. Returns null on any failure
// (rate limit, network) — the caller then omits the count chip entirely.
async function getRepoStars(): Promise<number | null> {
  try {
    const res = await fetch("https://api.github.com/repos/orbita-pos/openlen", {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "openlen-site",
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { stargazers_count?: unknown };
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : null;
  } catch {
    return null;
  }
}

function formatStars(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

export async function Hero() {
  const t = await getTranslations("marketing");
  // Real numbers for the trust row. Each chip hides itself when there is
  // nothing real to show yet (pre-launch): a 0 page count and a 0 / failed
  // star fetch each drop their chip instead of rendering a sad "0".
  const [pagesThisWeek, stars] = await Promise.all([
    countProjectsSince(7).catch(() => 0),
    getRepoStars(),
  ]);

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-60" aria-hidden />
      <div className="absolute inset-x-0 top-0 h-[640px] hero-glow" aria-hidden />
      <div
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-coral-500/60 to-transparent"
        aria-hidden
      />

      <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-24 sm:pt-28 sm:pb-32">
        <div className="flex flex-col items-center text-center">
          <Link
            href="/templates"
            className="group inline-flex items-center gap-2 rounded-full bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 px-3 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 shadow-sm hover:ring-zinc-300 dark:hover:ring-zinc-700 transition"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-coral-500/10 text-coral-700 dark:text-coral-300 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
              {t("hero.alphaBadge")}
            </span>
            {t("hero.alphaPitch")}
            <ArrowRight
              size={12}
              className="opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100"
            />
          </Link>

          <h1 className="mt-7 max-w-4xl text-balance text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tightest leading-[1.02]">
            {t.rich("hero.title", {
              br: () => <br />,
              muted: (chunks) => (
                <span className="text-zinc-500 dark:text-zinc-400">{chunks}</span>
              ),
              gradient: (chunks) => (
                <span className="bg-gradient-to-br from-coral-500 to-coral-700 bg-clip-text text-transparent">
                  {chunks}
                </span>
              ),
            })}
          </h1>

          <p className="mt-6 max-w-xl text-pretty text-lg text-zinc-600 dark:text-zinc-400">
            {t.rich("hero.subtitle", {
              strong: (chunks) => (
                <span className="text-zinc-900 dark:text-zinc-100 font-medium">
                  {chunks}
                </span>
              ),
            })}
          </p>
          <p className="mt-3 max-w-xl text-pretty text-sm text-zinc-500 dark:text-zinc-400">
            {t("hero.tagline")}
          </p>

          <div className="mt-10 w-full max-w-2xl">
            <HeroPromptInput />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
            {pagesThisWeek > 0 && (
              <>
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-1.5">
                    {avatarColors.map((c, i) => (
                      <span
                        key={i}
                        className="h-5 w-5 rounded-full ring-2 ring-white dark:ring-[#0a0a0a]"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <span>
                    {t.rich("hero.pagesThisWeek", {
                      count: pagesThisWeek,
                      strong: (chunks) => (
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          {chunks}
                        </span>
                      ),
                    })}
                  </span>
                </div>
                <span className="hidden sm:inline text-zinc-300 dark:text-zinc-800">
                  ·
                </span>
              </>
            )}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={t("hero.githubAria")}
              className="inline-flex items-center gap-1.5 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
            >
              <GithubIcon size={12} />
              <span>{t("hero.starOnGithub")}</span>
              {stars != null && stars > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-zinc-600 dark:text-zinc-400">
                  <Star size={9} className="text-amber-500" />
                  {formatStars(stars)}
                </span>
              )}
            </a>
          </div>

        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-white dark:to-[#0a0a0a]"
        aria-hidden
      />
    </section>
  );
}
