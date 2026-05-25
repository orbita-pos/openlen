import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { Badge } from "@/components/ui/badge";
import { formatDate, listPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Product updates, releases, and changelog from OpenLen — the open-source AI landing-page generator.",
  openGraph: {
    title: "Blog | OpenLen",
    description: "Product updates and releases from OpenLen.",
    type: "website",
    url: "https://openlen.com/blog",
  },
  twitter: {
    card: "summary_large_image",
    title: "Blog | OpenLen",
    description: "Product updates and releases from OpenLen.",
  },
  alternates: { canonical: "https://openlen.com/blog" },
};

export default function BlogIndexPage() {
  const posts = listPosts();

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950">
      <MarketingChrome>
        {/* Header */}
        <section className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto max-w-3xl px-6 py-10 sm:py-14">
            <div className="inline-flex items-center gap-2 text-[11px] font-medium text-coral-700 dark:text-coral-400 mb-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-coral-500 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-coral-500" />
              </span>
              BLOG
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tightest leading-[1.05]">
              What&apos;s new in OpenLen
            </h1>
            <p className="mt-3 text-zinc-600 dark:text-zinc-400">
              Releases, changelog, and the thinking behind them.
            </p>
          </div>
        </section>

        {/* Post list */}
        <div className="mx-auto max-w-3xl px-6 py-10 sm:py-12">
          <ul className="space-y-4">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="group block rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] p-6 hover:ring-zinc-300 dark:hover:ring-zinc-700 transition"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {post.version && <Badge tone="coral">{post.version}</Badge>}
                    <span className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-medium">
                      {post.tag}
                    </span>
                    <span className="text-zinc-300 dark:text-zinc-700">·</span>
                    <time
                      dateTime={post.date}
                      className="text-[11px] text-zinc-500 dark:text-zinc-400"
                    >
                      {formatDate(post.date)}
                    </time>
                  </div>
                  <h2 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {post.title}
                  </h2>
                  <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {post.excerpt}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-coral-700 dark:text-coral-400">
                    Read post
                    <ArrowRight
                      size={14}
                      className="transition group-hover:translate-x-0.5"
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Schema.org — Blog with its posts. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Blog",
              name: "OpenLen Blog",
              url: "https://openlen.com/blog",
              blogPost: posts.map((p) => ({
                "@type": "BlogPosting",
                headline: p.title,
                description: p.excerpt,
                datePublished: p.date,
                url: `https://openlen.com/blog/${p.slug}`,
              })),
            }),
          }}
        />
      </MarketingChrome>
    </div>
  );
}
