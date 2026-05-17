// Top bar — wordmark + editable project name + inline-edit toggle +
// publish split-button + theme toggle + avatar.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Moon,
  Pencil,
  RefreshCw,
  Sparkles,
  Sun,
  X,
} from "./icons";
import { Button, IconBtn, Tooltip } from "./ui";

interface TopBarProps {
  projectName: string;
  onRename: (name: string) => void;
  inlineEdit: boolean;
  setInlineEdit: (v: boolean) => void;
  onPublish?: () => void;
  publishedUrl?: string | null;
  dark: boolean;
  onToggleDark: () => void;
}

export function TopBar({
  projectName,
  onRename,
  inlineEdit,
  setInlineEdit,
  onPublish,
  publishedUrl,
  dark,
  onToggleDark,
}: TopBarProps) {
  const [publishOpen, setPublishOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const pubRef = useRef<HTMLDivElement>(null);
  const profRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(projectName);
  }, [projectName]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (pubRef.current && t && !pubRef.current.contains(t))
        setPublishOpen(false);
      if (profRef.current && t && !profRef.current.contains(t))
        setProfileOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

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
        <Tooltip
          label={inlineEdit ? "Inline edit: ON (⌘E)" : "Inline edit: OFF (⌘E)"}
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

        <div className="relative ml-0.5" ref={pubRef}>
          <div className="inline-flex">
            <Button
              variant="primary"
              size="md"
              className="!rounded-r-none !pr-2.5"
              onClick={() => onPublish?.()}
              disabled={!onPublish}
            >
              <Sparkles size={13} /> Publish
            </Button>
            <button
              type="button"
              onClick={() => setPublishOpen((o) => !o)}
              className="h-8 px-1.5 rounded-r-lg bg-[var(--accent)] text-white border border-l-0 border-[var(--accent)] hover:brightness-105 shadow-coral focus:outline-none"
            >
              <ChevronDown
                size={13}
                className={`transition ${publishOpen ? "rotate-180" : ""}`}
              />
            </button>
          </div>
          {publishOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl bg-elev border bd shadow-elev p-1 z-40 fade-in">
              <button
                type="button"
                onClick={() => {
                  setPublishOpen(false);
                  onPublish?.();
                }}
                className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-md text-[13px] fg hover:bg-hover transition"
              >
                <RefreshCw size={13} className="fg-muted" /> Re-publish
              </button>
              <a
                href={publishedUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                onClick={() => setPublishOpen(false)}
                className={`flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-md text-[13px] hover:bg-hover transition ${
                  publishedUrl ? "fg" : "fg-faint pointer-events-none"
                }`}
              >
                <ExternalLink size={13} className="fg-muted" /> Open published
                page
              </a>
              <div className="border-t bd my-1" />
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-md text-[13px] text-red-600 dark:text-red-400 hover:bg-red-500/10 transition"
              >
                <X size={13} /> Unpublish
              </button>
              {publishedUrl && (
                <>
                  <div className="border-t bd my-1" />
                  <div className="px-2.5 py-1.5 text-[10.5px] fg-faint font-mono break-all">
                    {publishedUrl.replace(/^https?:\/\//, "")}
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
