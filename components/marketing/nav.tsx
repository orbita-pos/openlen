"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Moon, Star, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/cn";

const links = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "Docs", href: "#docs" },
] as const;

export interface NavProps {
  dark: boolean;
  onToggleDark: () => void;
}

export function Nav({ dark, onToggleDark }: NavProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-200",
        scrolled
          ? "border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/75 dark:bg-[#0a0a0a]/75 backdrop-blur-md"
          : "bg-transparent",
      )}
    >
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <span className="relative inline-flex h-6 w-6 items-center justify-center">
            <span className="absolute inset-0 rounded-md bg-coral-500" />
            <span className="relative font-bold text-white text-[13px] leading-none">
              い
            </span>
          </span>
          <span className="font-semibold tracking-tight text-[15px]">OpenLen</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="px-3 py-1.5 rounded-md text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
            >
              {l.label}
            </a>
          ))}
          <a
            href="https://github.com"
            className="ml-1 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
          >
            <GithubIcon size={14} />
            <span>GitHub</span>
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-900 px-2 py-0.5 text-[11px] font-medium tabular-nums">
              <Star size={10} className="text-amber-500" />
              2.4k
            </span>
          </a>
        </nav>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleDark}
            aria-label="Toggle dark mode"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link
            href="/login"
            className="hidden sm:inline-flex items-center h-9 px-3 rounded-md text-[13px] font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            Sign in
          </Link>
          <Link href="/register" className="hidden sm:inline-flex">
            <Button size="sm">
              Try it free <ArrowRight size={14} />
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
