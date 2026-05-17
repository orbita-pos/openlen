// Top bar — wordmark + editable project name + inline-edit toggle +
// Deploy dropdown (ported from /new's Header so the publish UX is identical
// across V1 and V2) + theme toggle + avatar.
//
// Session 11 contract — the parent passes `published` (null when the project
// has no claimed subdomain, otherwise { subdomain, hasUnpublishedChanges })
// and `onPublishClick` to open the PublishModal. The dropdown itself never
// calls /api/projects/[id]/publish directly; that's the modal's job.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Moon,
  Pencil,
  RefreshCw,
  Sparkles,
  Sun,
  X,
} from "./icons";
import { IconBtn, Tooltip } from "./ui";

interface TopBarProps {
  projectName: string;
  onRename: (name: string) => void;
  inlineEdit: boolean;
  setInlineEdit: (v: boolean) => void;
  /** When false, the Edit-inline toggle is hidden. Inline editing only
   *  applies to AI-generated projects whose blocks are wrapped in
   *  `<EditableText>`; template-clone / paste projects have no slot
   *  markers, so the toggle would do nothing. Default true. */
  inlineEditAvailable?: boolean;
  /** Open the PublishModal. Pass undefined to disable the Deploy CTA
   *  (no project loaded / not yet ready to ship). */
  onPublish?: () => void;
  /** When the project is published, this carries the live subdomain + drift
   *  flag. When null, the dropdown shows the first-publish CTA. */
  published?: { subdomain: string; hasUnpublishedChanges: boolean } | null;
  dark: boolean;
  onToggleDark: () => void;
}

export function TopBar({
  projectName,
  onRename,
  inlineEdit,
  setInlineEdit,
  inlineEditAvailable = true,
  onPublish,
  published,
  dark,
  onToggleDark,
}: TopBarProps) {
  const [deployOpen, setDeployOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const deployRef = useRef<HTMLDivElement>(null);
  const profRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(projectName);
  }, [projectName]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (deployRef.current && t && !deployRef.current.contains(t))
        setDeployOpen(false);
      if (profRef.current && t && !profRef.current.contains(t))
        setProfileOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const liveUrl = published
    ? `https://${published.subdomain}.openlen.com`
    : null;

  return (
    <header className="relative z-30 h-[60px] shrink-0 border-b bd bg-app flex items-center justify-between px-3 sm:px-4 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <a href="/projects" className="flex items-center gap-2 shrink-0">
          <span className="relative inline-flex h-7 w-7 items-center justify-center">
            <span className="absolute inset-0 rounded-md bg-[var(--accent)]" />
            <svg
              viewBox="0 0 24 24"
              className="relative w-4 h-4"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              aria-hidden
            >
              <path d="M4 12 L10 6 L10 18 Z" fill="white" />
              <path d="M14 6 L20 12 L14 18" />
            </svg>
          </span>
          <span className="font-display text-[15px] tracking-tight hidden md:inline">
            OpenLen
          </span>
        </a>
        <div className="h-5 w-px bg-[color:var(--border)] hidden md:block" />
        <button
          type="button"
          onClick={() => setEditingName(true)}
          className="inline-flex items-center gap-1.5 max-w-[260px] px-2 h-7 rounded-md hover:bg-hover transition group"
        >
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
              className="bg-transparent text-[13px] outline-none min-w-[120px] fg"
            />
          ) : (
            <>
              <span className="text-[13px] fg-muted">Workspace</span>
              <span className="fg-faint">—</span>
              <span className="text-[13px] font-medium fg truncate">
                {projectName}
              </span>
            </>
          )}
          <ChevronDown size={12} className="fg-faint shrink-0" />
        </button>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2" />
      <div className="flex items-center gap-1">
        {inlineEditAvailable && (
          <Tooltip
            label={
              inlineEdit ? "Inline edit: ON (⌘E)" : "Inline edit: OFF (⌘E)"
            }
          >
            <button
              type="button"
              onClick={() => setInlineEdit(!inlineEdit)}
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium transition ${
                inlineEdit
                  ? "bg-[var(--accent)] text-white shadow-coral"
                  : "fg-muted border bd hover:fg hover:bg-hover hover:border-[color:var(--border-strong)]"
              }`}
            >
              <Pencil
                size={13}
                className={`transition-transform ${
                  inlineEdit ? "rotate-[12deg]" : ""
                }`}
              />
              <span className="hidden lg:inline">Edit inline</span>
            </button>
          </Tooltip>
        )}

        {/* Deploy dropdown — same pattern as /new's Header. The actual
            publish is handled by PublishModal which the parent renders;
            we only toggle it. */}
        <div className="relative ml-0.5" ref={deployRef}>
          <button
            type="button"
            onClick={() => setDeployOpen((o) => !o)}
            disabled={!onPublish}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-md bg-[var(--accent)] text-white text-[12px] font-medium hover:brightness-105 active:brightness-95 shadow-coral transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles size={12} />
            <span className="hidden sm:inline">Deploy</span>
            <ChevronDown
              size={11}
              className={`transition ${deployOpen ? "rotate-180" : ""}`}
            />
          </button>
          {deployOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-xl bg-elev border bd shadow-elev p-1.5 z-50 fade-in">
              <div className="px-2.5 pt-1.5 pb-2 text-[10px] uppercase tracking-wider fg-faint">
                Ship it
              </div>

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
                    {liveUrl && (
                      <a
                        href={liveUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setDeployOpen(false)}
                        className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/10 transition"
                      >
                        <ExternalLink size={10} /> Open
                      </a>
                    )}
                    {onPublish && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setDeployOpen(false);
                            onPublish();
                          }}
                          className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/10 transition"
                        >
                          <RefreshCw size={10} /> Re-publish
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeployOpen(false);
                            onPublish();
                          }}
                          className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition"
                        >
                          <X size={10} /> Unpublish
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
                    onPublish?.();
                  }}
                  disabled={!onPublish}
                  className="flex items-center gap-3 w-full text-left px-2.5 py-2 rounded-md hover:bg-hover transition group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[var(--accent)]">
                    <Globe size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold tracking-tight fg">
                      Publish to openlen.com
                    </span>
                    <span className="block text-[11px] fg-faint">
                      Free hosting on your own subdomain
                    </span>
                  </span>
                  <ChevronRight size={12} className="fg-faint group-hover:text-[var(--accent)] transition" />
                </button>
              )}

              <div className="border-t bd my-1" />

              {[
                { label: "Deploy to Vercel", sub: "Coming soon" },
                { label: "Push to GitHub", sub: "Coming soon" },
                { label: "Deploy to Cloudflare", sub: "Coming soon" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  disabled
                  className="flex items-center gap-3 w-full text-left px-2.5 py-2 rounded-md opacity-50 cursor-not-allowed"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-app fg-muted">
                    <Globe size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium fg">
                      {o.label}
                    </span>
                    <span className="block text-[11px] fg-faint">{o.sub}</span>
                  </span>
                </button>
              ))}

              {published && liveUrl && (
                <>
                  <div className="border-t bd my-1" />
                  <div className="px-2.5 py-1.5 text-[10.5px] fg-faint font-mono break-all">
                    {liveUrl.replace(/^https?:\/\//, "")}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <span className="hidden md:inline-block h-5 w-px bg-[color:var(--border)] mx-1.5" />
        <IconBtn label={dark ? "Light mode" : "Dark mode"} onClick={onToggleDark}>
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </IconBtn>
        <div className="relative" ref={profRef}>
          <button
            type="button"
            onClick={() => setProfileOpen((o) => !o)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white text-[11.5px] font-semibold ring-1 ring-white/30"
          >
            J
          </button>
          {profileOpen && (
            <div className="absolute right-0 mt-2 w-52 rounded-xl bg-elev border bd shadow-elev p-1 z-40 fade-in">
              <div className="px-2.5 py-2 border-b bd">
                <div className="text-[12.5px] font-medium fg">Jesus B.</div>
                <div className="text-[11px] fg-faint">jose12cheti12@gmail.com</div>
              </div>
              <a
                href="/projects"
                className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-md text-[13px] fg hover:bg-hover transition"
              >
                Projects
              </a>
              <button
                type="button"
                className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-md text-[13px] fg hover:bg-hover transition"
              >
                Account
              </button>
              <button
                type="button"
                className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-md text-[13px] fg hover:bg-hover transition"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
