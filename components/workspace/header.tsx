"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudCheck,
  Download,
  ExternalLink,
  Globe,
  Moon,
  RefreshCw,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { GithubIcon } from "@/components/ui/brand-icons";
import { VercelLogo } from "./vercel-logo";
import { cn } from "@/lib/cn";

export interface HeaderProps {
  saved: boolean;
  savedLabel: string;
  dark: boolean;
  onToggleDark: () => void;
  projectName: string;
  onRename: (next: string) => void;
  generated: boolean;
  totalCost?: number;
  onDownloadZip?: () => void;
  downloadingZip?: boolean;
  // Session 11 — surfaces the current publish state in the Deploy menu and
  // gives the workspace a way to open the publish modal from in here. Pass
  // `null` for `published` when the project isn't published.
  published?: {
    subdomain: string;
    hasUnpublishedChanges: boolean;
  } | null;
  onPublishClick?: () => void;
}

function formatUsd(n: number) {
  return `$${n.toFixed(2)}`;
}

export function Header({
  saved,
  savedLabel,
  dark,
  onToggleDark,
  projectName,
  onRename,
  generated,
  totalCost,
  onDownloadZip,
  downloadingZip,
  published,
  onPublishClick,
}: HeaderProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const profRef = useRef<HTMLDivElement>(null);
  const deployRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (profRef.current && !profRef.current.contains(e.target as Node))
        setProfileOpen(false);
      if (deployRef.current && !deployRef.current.contains(e.target as Node))
        setDeployOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(projectName);
  useEffect(() => setDraft(projectName), [projectName]);

  const comingSoon = (label: string) => () => {
    setDeployOpen(false);
    alert(`${label} — coming in Phase 1B.`);
  };

  return (
    <header className="sticky top-0 z-40 h-14 shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-[#0a0a0a]/85 backdrop-blur-md">
      <div className="h-full px-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 group shrink-0">
            <span className="relative inline-flex h-6 w-6 items-center justify-center">
              <span className="absolute inset-0 rounded-md bg-coral-500" />
              <span className="relative font-bold text-white text-[13px] leading-none">
                い
              </span>
            </span>
            <span className="hidden sm:inline font-semibold tracking-tight text-[14px]">
              OpenLen
            </span>
          </Link>
          <div className="hidden md:block h-5 w-px bg-zinc-200 dark:bg-zinc-800 shrink-0" />
          <nav className="flex items-center gap-1.5 text-sm min-w-0">
            <Link
              href="/projects"
              className="hidden md:inline text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition shrink-0"
            >
              My pages
            </Link>
            <ChevronRight
              size={14}
              className="hidden md:inline text-zinc-300 dark:text-zinc-700 shrink-0"
            />
            {editingName ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  onRename(draft.trim() || "Untitled");
                  setEditingName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    setDraft(projectName);
                    setEditingName(false);
                  }
                }}
                className="h-7 px-1.5 -mx-1.5 text-sm font-medium bg-transparent ring-1 ring-coral-500 rounded outline-none min-w-[120px]"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded px-1.5 -mx-1.5 py-0.5 truncate max-w-[200px] sm:max-w-[280px]"
              >
                {projectName}
              </button>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {generated && (
            <>
              {typeof totalCost === "number" && (
                <Tooltip
                  side="bottom"
                  label={
                    <span className="tabular-nums">
                      Total: {formatUsd(totalCost)}
                    </span>
                  }
                >
                  <span className="hidden lg:inline-flex items-center gap-1.5 h-7 px-2 rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] text-[11px] text-zinc-500 cursor-default">
                    <Sparkles size={11} className="text-coral-500" />
                    <span className="tabular-nums">{formatUsd(totalCost)}</span>
                  </span>
                </Tooltip>
              )}

              <span className="hidden sm:inline-flex">
                <IconButton
                  label={downloadingZip ? "Preparing .zip…" : "Download .zip"}
                  disabled={!onDownloadZip || downloadingZip}
                  onClick={() => onDownloadZip?.()}
                >
                  <Download size={14} className={cn(downloadingZip && "animate-pulse")} />
                </IconButton>
              </span>

              <div className="relative" ref={deployRef}>
                <button
                  type="button"
                  onClick={() => setDeployOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-md bg-coral-500 text-white text-[12px] font-medium hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow transition"
                >
                  <Sparkles size={12} />
                  <span className="hidden sm:inline">Deploy</span>
                  <ChevronDown
                    size={11}
                    className={cn("transition", deployOpen && "rotate-180")}
                  />
                </button>
                {deployOpen && (
                  <div className="absolute right-0 mt-2 w-72 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] shadow-xl p-1.5 z-50">
                    <div className="px-2.5 pt-1.5 pb-2 text-[10px] uppercase tracking-wider text-zinc-400">
                      Ship it
                    </div>

                    {/* Session 11 — primary publish item. Mirrors the Vercel
                        row style but with a clickable live-status block when
                        the page is already published. */}
                    {published ? (
                      <div className="rounded-md ring-1 ring-emerald-200 dark:ring-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 px-2.5 py-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className="relative inline-flex h-2 w-2 shrink-0">
                            <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-70 animate-ping" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                          </span>
                          <span className="text-[11.5px] font-semibold tracking-tight text-emerald-800 dark:text-emerald-300 truncate">
                            Live at {published.subdomain}.openlen.com
                          </span>
                        </div>
                        {published.hasUnpublishedChanges && (
                          <div className="mt-1 text-[10.5px] text-amber-700 dark:text-amber-300">
                            You have unpublished changes.
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          <a
                            href={`https://${published.subdomain}.openlen.com`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => setDeployOpen(false)}
                            className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/10 transition"
                          >
                            <ExternalLink size={10} /> Open
                          </a>
                          {onPublishClick && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeployOpen(false);
                                  onPublishClick();
                                }}
                                className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/10 transition"
                              >
                                <RefreshCw size={10} /> Re-publish
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeployOpen(false);
                                  onPublishClick();
                                }}
                                className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition"
                              >
                                <Trash2 size={10} /> Unpublish
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setDeployOpen(false);
                          onPublishClick?.();
                        }}
                        disabled={!onPublishClick}
                        className="flex items-center gap-3 w-full text-left px-2.5 py-2 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900 transition group disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-coral-200 dark:ring-coral-500/30 bg-coral-50 dark:bg-coral-500/10 text-coral-600 dark:text-coral-400">
                          <Globe size={13} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                            Publish to openlen.com
                          </span>
                          <span className="block text-[11px] text-zinc-500">
                            Free hosting on your own subdomain
                          </span>
                        </span>
                        <ArrowRight
                          size={12}
                          className="text-zinc-300 group-hover:text-coral-500 transition"
                        />
                      </button>
                    )}

                    <div className="border-t border-zinc-100 dark:border-zinc-900 my-1" />

                    {[
                      {
                        label: "Deploy to Vercel",
                        sub: "Coming in Phase 1B",
                        icon: <VercelLogo size={12} />,
                      },
                      {
                        label: "Push to GitHub",
                        sub: "Coming in Phase 1B",
                        icon: <GithubIcon size={13} />,
                      },
                      {
                        label: "Deploy to Cloudflare",
                        sub: "Coming in Phase 1B",
                        icon: <Globe size={13} />,
                      },
                    ].map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        onClick={comingSoon(o.label)}
                        className="flex items-center gap-3 w-full text-left px-2.5 py-2 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900 transition group"
                      >
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] text-zinc-700 dark:text-zinc-300">
                          {o.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
                            {o.label}
                          </span>
                          <span className="block text-[11px] text-zinc-500">
                            {o.sub}
                          </span>
                        </span>
                        <ArrowRight
                          size={12}
                          className="text-zinc-300 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition"
                        />
                      </button>
                    ))}
                    <div className="border-t border-zinc-100 dark:border-zinc-900 my-1" />
                    <button
                      type="button"
                      disabled={!onDownloadZip || downloadingZip}
                      onClick={() => {
                        setDeployOpen(false);
                        onDownloadZip?.();
                      }}
                      className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-md text-[12px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download size={12} className={cn(downloadingZip && "animate-pulse")} />
                      {downloadingZip ? "Preparing .zip…" : "Download .zip instead"}
                    </button>
                  </div>
                )}
              </div>
              <div className="hidden sm:block h-5 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />
            </>
          )}

          <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500 mr-1">
            {saved ? (
              <CloudCheck size={14} className="text-emerald-500" />
            ) : (
              <Cloud size={14} className="text-zinc-400 animate-pulse" />
            )}
            <span>{savedLabel}</span>
          </div>

          <IconButton
            label={dark ? "Light mode" : "Dark mode"}
            onClick={onToggleDark}
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </IconButton>

          <UserMenu open={profileOpen} setOpen={setProfileOpen} profRef={profRef} />
        </div>
      </div>
    </header>
  );
}

function UserMenu({
  open,
  setOpen,
  profRef,
}: {
  open: boolean;
  setOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  profRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { data: session } = useSession();
  const user = session?.user;
  const initials = useMemo(() => {
    const source = user?.name || user?.email || "";
    if (!source) return "U";
    const parts = source.split(/[\s@.]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
  }, [user?.name, user?.email]);

  return (
    <div className="relative" ref={profRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full h-8 pl-0.5 pr-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-coral-400 to-coral-700 text-white text-[11px] font-semibold ring-2 ring-white dark:ring-[#0a0a0a]">
          {initials}
        </span>
        <ChevronDown size={13} className="text-zinc-400" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] shadow-lg p-1.5">
          <div className="px-3 py-2.5">
            <div className="text-sm font-medium truncate">
              {user?.name ?? "Signed in"}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              {user?.email ?? "—"}
            </div>
          </div>
          <div className="border-t border-zinc-100 dark:border-zinc-900 my-1" />
          <Link
            href="/projects"
            className="flex items-center w-full text-left px-3 py-1.5 rounded-md text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            My pages
          </Link>
          {["Settings", "Billing", "API keys"].map((l) => (
            <button
              type="button"
              key={l}
              className="flex items-center w-full text-left px-3 py-1.5 rounded-md text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              {l}
            </button>
          ))}
          <div className="border-t border-zinc-100 dark:border-zinc-900 my-1" />
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/login" })}
            className="flex items-center w-full text-left px-3 py-1.5 rounded-md text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
