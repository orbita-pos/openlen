import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { MarketingChrome } from "@/components/marketing/marketing-chrome";
import { Badge } from "@/components/ui/badge";
import { formatDate, getPost, listPosts } from "@/lib/blog";

interface PageProps {
  params: Promise<{ slug: string; locale: string }>;
}

// Only the slugs from listPosts() are valid — any other slug 404s.
export const dynamicParams = false;

export function generateStaticParams() {
  return listPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: "Post not found" };
  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: `${post.title} | OpenLen`,
      description: post.excerpt,
      type: "article",
      url: `https://openlen.com/blog/${post.slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title: `${post.title} | OpenLen`,
      description: post.excerpt,
    },
    alternates: { canonical: `https://openlen.com/blog/${post.slug}` },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pages");
  const post = getPost(slug);
  if (!post) notFound();

  const { Body } = post;

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950">
      <MarketingChrome>
        <article className="mx-auto max-w-2xl px-6 pt-8 sm:pt-10 pb-20">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
          >
            <ArrowLeft size={12} />
            {t("blogPost.back")}
          </Link>

          <div className="mt-6 flex flex-wrap items-center gap-2">
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

          <h1 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tightest leading-[1.08]">
            {post.title}
          </h1>
          <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed">
            {post.excerpt}
          </p>

          <div className="mt-8 border-t border-zinc-200 dark:border-zinc-800 pt-8">
            <Body />
          </div>
        </article>

        {/* Schema.org — BlogPosting. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "BlogPosting",
              headline: post.title,
              description: post.excerpt,
              datePublished: post.date,
              url: `https://openlen.com/blog/${post.slug}`,
              publisher: {
                "@type": "Organization",
                name: "OpenLen",
                url: "https://openlen.com",
              },
            }),
          }}
        />
      </MarketingChrome>
    </div>
  );
}
