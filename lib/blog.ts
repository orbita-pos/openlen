import type { ComponentType } from "react";
import { meta as geminiMeta, Body as geminiBody } from "@/content/blog/powered-by-gemini";

// ─────────────────────────────────────────────────────────────────────────────
// Blog / changelog registry. Posts are in-repo: each is a single
// content/blog/<slug>.tsx file exporting `meta` (the metadata below) and
// `Body` (a React component with the article). To add a post: create that
// file, then add one import + one POSTS entry here.
// ─────────────────────────────────────────────────────────────────────────────

export interface BlogPostMeta {
  /** URL slug — the post lives at /blog/<slug>. */
  slug: string;
  title: string;
  /** One-line summary — card subtitle and <meta> description. */
  excerpt: string;
  /** ISO date (YYYY-MM-DD). Sorted on; rendered via formatDate. */
  date: string;
  /** Short label shown on the card, e.g. "Release". */
  tag: string;
  /** Optional version string, e.g. "v0.4". */
  version?: string;
}

export interface BlogPost extends BlogPostMeta {
  /** The article body. */
  Body: ComponentType;
}

const POSTS: BlogPost[] = [{ ...geminiMeta, Body: geminiBody }];

/** Every post, newest first. */
export function listPosts(): BlogPost[] {
  return [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
}

/** One post by slug, or undefined when nothing matches. */
export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}

/** Render an ISO date as e.g. "May 20, 2026". */
export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
