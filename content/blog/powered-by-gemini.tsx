import { MessageSquare, Sparkles } from "lucide-react";
import type { BlogPostMeta } from "@/lib/blog";

export const meta: BlogPostMeta = {
  slug: "powered-by-gemini",
  title: "Powered by Gemini 3.1 Pro",
  excerpt:
    "Every page OpenLen builds — generated from a brief or redesigned in chat — runs on Google's Gemini 3.1 Pro.",
  date: "2026-05-27",
  tag: "Release",
};

export function Body() {
  return (
    <div className="text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
      <p>
        OpenLen builds your landing page two ways — you generate one from a
        one-line brief, or you redesign it by chatting with it. Both run on
        Google&apos;s{" "}
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          Gemini 3.1 Pro
        </span>
        .
      </p>

      <h2 className="mt-10 mb-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        One engine, both surfaces
      </h2>
      <p>
        No pipeline of small steps stitched together. OpenLen uses AI in two
        places, and both go straight to Gemini:
      </p>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-zinc-50/60 dark:bg-zinc-950 p-5">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-coral-50 text-coral-600 dark:bg-coral-500/10 dark:text-coral-400 ring-1 ring-coral-200/60 dark:ring-coral-500/20">
            <Sparkles size={15} />
          </div>
          <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Generate
          </div>
          <p className="mt-1 text-sm">
            Describe your page in plain language. One streaming call returns a
            complete, self-contained HTML page — structure, copy, and styling,
            start to finish.
          </p>
        </div>
        <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-zinc-50/60 dark:bg-zinc-950 p-5">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-coral-50 text-coral-600 dark:bg-coral-500/10 dark:text-coral-400 ring-1 ring-coral-200/60 dark:ring-coral-500/20">
            <MessageSquare size={15} />
          </div>
          <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Chat
          </div>
          <p className="mt-1 text-sm">
            Talk to your page. Gemini reads the whole document and your request,
            then makes a surgical edit or rebuilds the layout — your call,
            every turn.
          </p>
        </div>
      </div>

      <h2 className="mt-10 mb-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Why a frontier model
      </h2>
      <p>
        Gemini 3.1 Pro reads your entire page at once — a context window large
        enough to hold every section and every class in view. When you ask for
        a change it reasons about the whole page instead of a fragment, so edits
        stay coherent: the new hero still matches the footer.
      </p>

      <h2 className="mt-10 mb-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Two speeds, your call
      </h2>
      <p>
        Gemini 3.1 Pro is the default — the most considered structure, copy, and
        design taste, guided by a design system baked into OpenLen. When you want
        a draft fast, switch to{" "}
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          Gemini 3.5 Flash
        </span>{" "}
        from the model picker. Either way you watch it work: the reasoning and
        the page itself stream in live as it builds.
      </p>

      <p className="mt-8 border-t border-zinc-200 dark:border-zinc-800 pt-6 font-medium text-zinc-900 dark:text-zinc-100">
        Gemini 3.1 Pro by default, Gemini 3.5 Flash when you&apos;re in a hurry —
        your whole page, either way.
      </p>
    </div>
  );
}
