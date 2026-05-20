import { FileCode, ShieldCheck } from "lucide-react";
import { GithubIcon, TwitterIcon } from "@/components/ui/brand-icons";
import { OpenLenMark } from "@/components/openlen-logo";

const columns = [
  { title: "Product", links: ["Features", "Pricing", "Changelog", "Roadmap"] },
  { title: "Open source", links: ["GitHub", "AGPL license", "Contribute", "Discord"] },
  { title: "Company", links: ["Blog", "Privacy", "Terms", "Contact"] },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          <div className="col-span-2 md:col-span-2">
            <a href="#top" className="flex items-center gap-2 group">
              <OpenLenMark className="h-6 w-6 shrink-0" />
              <span className="font-semibold tracking-tight">
                Open<span className="text-coral-500 dark:text-coral-400">Len</span>
              </span>
            </a>
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
              The open-source AI landing-page generator. Lovable quality, your code,
              $19/month.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <a
                href="https://github.com"
                aria-label="GitHub"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 text-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition"
              >
                <GithubIcon size={15} />
              </a>
              <a
                href="https://twitter.com"
                aria-label="Twitter"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 text-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition"
              >
                <TwitterIcon size={15} />
              </a>
              <a
                href="#docs"
                aria-label="Docs"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 text-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition"
              >
                <FileCode size={15} />
              </a>
            </div>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {col.title}
              </div>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l}>
                    <a
                      href="#"
                      className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 pt-6 border-t border-zinc-100 dark:border-zinc-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex flex-wrap items-center gap-3">
            <span>© 2026 OpenLen</span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <a
              href="#license"
              className="hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center gap-1.5"
            >
              <ShieldCheck size={12} /> AGPL-3.0 licensed
            </a>
            <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">·</span>
            <span className="hidden sm:inline">
              Built with OpenLen, naturally.
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            All systems operational
          </div>
        </div>
      </div>
    </footer>
  );
}
