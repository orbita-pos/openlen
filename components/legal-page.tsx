import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { OpenLenMark } from "@/components/openlen-logo";

// Shared shell for the simple standalone pages (privacy / terms / support /
// docs). Quick + honest drafts to back the Vercel/GitHub integration form URLs;
// prettify later. Server component — no client hooks.
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 sm:py-24">
      <Link
        href="/"
        className="inline-flex items-center gap-2 mb-10 text-zinc-900 dark:text-zinc-100 hover:opacity-80 transition"
      >
        <OpenLenMark className="h-7 w-7" />
        <span className="font-semibold tracking-tight text-[15px]">
          Open<span className="text-coral-700 dark:text-coral-400">Len</span>
        </span>
      </Link>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">
        {title}
      </h1>
      {updated && (
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-8">{updated}</p>
      )}
      <div className="space-y-4 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300 [&_h2]:text-zinc-900 dark:[&_h2]:text-zinc-100 [&_h2]:font-semibold [&_h2]:text-[17px] [&_h2]:mt-8 [&_h2]:mb-1 [&_a]:text-coral-700 dark:[&_a]:text-coral-400 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1">
        {children}
      </div>
    </main>
  );
}
