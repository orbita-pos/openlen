// Top bar — wordmark + editable project name + Deploy dropdown (ported
// from /new's Header so the publish UX is identical across V1 and V2) +
// theme toggle + avatar.
//
// Session 11 contract — the parent passes `published` (null when the project
// has no claimed subdomain, otherwise { subdomain, hasUnpublishedChanges })
// and `onPublishClick` to open the PublishModal. The dropdown itself never
// calls /api/projects/[id]/publish directly; that's the modal's job.
//
// Inline edit used to live here as a toggle; it now lives implicitly in the
// Content sidebar tab (selecting that tab activates contentEditable in the
// iframe). ⌘E remains as a shortcut, handled in the parent.

"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { Redo2, Undo2 } from "lucide-react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  HistoryIcon,
  Moon,
  RefreshCw,
  Sparkles,
  Sun,
  X,
} from "./icons";
import { IconBtn, StatusDot } from "./ui";
import { CreditPill } from "@/components/app/credit-pill";
import { OpenLenMark } from "@/components/openlen-logo";

interface ReleaseEntry {
  sha: string;
  mtime: string;
  isCurrent: boolean;
}

interface TopBarProps {
  projectName: string;
  onRename: (name: string) => void;
  /** True while the parent is fetching `/api/projects/<id>`. The project
   *  name slot shows "Loading…" until the real title resolves, so the
   *  workspace stops flashing the mock "Pricing Page" placeholder. */
  projectLoading?: boolean;
  /** Lightweight save indicator next to the project name. Parent toggles
   *  this when section/design edits autosave. Null/idle = hidden. */
  savingStatus?: "idle" | "saving" | "saved" | null;
  /** Open the PublishModal. Pass undefined to disable the Deploy CTA
   *  (no project loaded / not yet ready to ship). */
  onPublish?: () => void;
  /** When the project is published, this carries the live subdomain + drift
   *  flag. When null, the dropdown shows the first-publish CTA. */
  published?: { subdomain: string; hasUnpublishedChanges: boolean } | null;
  /** Project ID — used to fetch the on-disk release list for the
   *  "Previous deploys" section. Optional: the section just hides if
   *  unset, so V1 callers and pre-Editing entry modes still render. */
  projectId?: string;
  /** Invoked after a successful rollback. Parent typically re-fetches
   *  the project so publishedAt + drift flag stay accurate. */
  onRolledBack?: () => void;
  dark: boolean;
  onToggleDark: () => void;
  /** Canva-mode undo/redo. Undefined → not in Canva-mode, buttons hidden.
   *  Defined → render the pair; the booleans drive the disabled state. */
  canvasUndo?: () => void;
  canvasRedo?: () => void;
  canvasCanUndo?: boolean;
  canvasCanRedo?: boolean;
  /** Canva-mode breakpoint picker. List of available breakpoints + current
   *  edit condition (null = base, or {kind:"breakpoint",bp}) + "agregar"
   *  callback that pushes a new bp onto the doc. The chip strip derives
   *  active-state from the condition; clicking a chip emits null (for
   *  "base") or the bp condition. */
  canvasBreakpoints?: Array<{ name: string; minWidth: number }>;
  canvasEditCondition?: import("@/lib/doc/model").Condition | null;
  canvasOnEditCondition?: (
    c: import("@/lib/doc/model").Condition | null,
  ) => void;
  canvasOnAddBp?: (name: string, minWidth: number) => void;
}

export function TopBar({
  projectName,
  onRename,
  projectLoading = false,
  savingStatus = null,
  onPublish,
  published,
  projectId,
  onRolledBack,
  dark,
  onToggleDark,
  canvasUndo,
  canvasRedo,
  canvasCanUndo = false,
  canvasCanRedo = false,
  canvasBreakpoints,
  canvasEditCondition = null,
  canvasOnEditCondition,
  canvasOnAddBp,
}: TopBarProps) {
  // Active-state derives from the condition. Only a breakpoint condition
  // counts here; state/mode conditions render no chip as active (the inspector
  // owns those).
  const activeBpName =
    canvasEditCondition?.kind === "breakpoint" ? canvasEditCondition.bp : "base";
  const [deployOpen, setDeployOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const [releases, setReleases] = useState<ReleaseEntry[] | null>(null);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [rollingSha, setRollingSha] = useState<string | null>(null);
  // Drives the "Saved · just now" fade. Goes true when savingStatus flips
  // to "saved" and back to false 3s later, so the indicator disappears on
  // its own without parent involvement.
  const [showSaved, setShowSaved] = useState(false);
  const [bpOpen, setBpOpen] = useState(false);
  const [bpCustomName, setBpCustomName] = useState("");
  const [bpCustomWidth, setBpCustomWidth] = useState("");
  const deployRef = useRef<HTMLDivElement>(null);
  const profRef = useRef<HTMLDivElement>(null);
  const bpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(projectName);
  }, [projectName]);

  // Close the bp popover on click-outside / Esc.
  useEffect(() => {
    if (!bpOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!bpRef.current?.contains(e.target as Node)) setBpOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBpOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [bpOpen]);

  useEffect(() => {
    if (savingStatus === "saved") {
      setShowSaved(true);
      const t = window.setTimeout(() => setShowSaved(false), 3000);
      return () => window.clearTimeout(t);
    }
    setShowSaved(false);
  }, [savingStatus]);

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

  // Fetch the on-disk release history when the Deploy dropdown opens for a
  // published project. The list shows up to 9 prior releases below the
  // current one (the current is rendered separately by the existing "Live
  // at …" pill, so we filter it out of the dropdown list).
  useEffect(() => {
    if (!deployOpen || !projectId || !published) {
      setReleases(null);
      return;
    }
    let cancelled = false;
    setReleasesLoading(true);
    void fetch(`/api/projects/${projectId}/releases`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.releases && Array.isArray(data.releases)) {
          setReleases(data.releases as ReleaseEntry[]);
        } else {
          setReleases([]);
        }
      })
      .catch(() => {
        if (!cancelled) setReleases([]);
      })
      .finally(() => {
        if (!cancelled) setReleasesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deployOpen, projectId, published]);

  const onRollbackClick = async (sha: string) => {
    if (!projectId || rollingSha) return;
    const ok = window.confirm(
      `Roll back the live site to deploy ${sha}? Visitors will see this earlier version within seconds.`,
    );
    if (!ok) return;
    setRollingSha(sha);
    try {
      const res = await fetch(`/api/projects/${projectId}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sha }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(
          body.error === "release_gone"
            ? "That deploy has been pruned from disk and can't be restored."
            : "Rollback failed. Try again.",
        );
        return;
      }
      setDeployOpen(false);
      onRolledBack?.();
    } finally {
      setRollingSha(null);
    }
  };

  const liveUrl = published
    ? `https://${published.subdomain}.openlen.com`
    : null;

  const saveVisible =
    savingStatus === "saving" || (savingStatus === "saved" && showSaved);

  return (
    <header className="relative z-30 h-[60px] shrink-0 border-b bd bg-app flex items-center justify-between px-3 sm:px-4 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <a
          href="/projects"
          className="flex items-center gap-2 shrink-0 rounded-md -mx-1 px-1 py-0.5 hover:bg-hover transition"
        >
          <OpenLenMark className="h-7 w-7 shrink-0" />
          <span className="font-display text-[15px] tracking-tight hidden md:inline">
            Open<span className="text-coral-500 dark:text-coral-400">Len</span>
          </span>
        </a>
        <div className="h-5 w-px bg-[color:var(--border)] hidden md:block" />
        <button
          type="button"
          onClick={() => {
            if (projectLoading) return;
            setEditingName(true);
          }}
          disabled={projectLoading}
          className="inline-flex items-center gap-1.5 max-w-[260px] min-w-0 px-2 h-7 rounded-md hover:bg-hover transition group disabled:cursor-default disabled:hover:bg-transparent"
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
              {projectLoading ? (
                <span className="text-[13px] font-medium fg-faint truncate animate-pulse">
                  Loading…
                </span>
              ) : (
                <span className="text-[13px] font-medium fg truncate">
                  {projectName}
                </span>
              )}
            </>
          )}
          <ChevronDown size={12} className="fg-faint shrink-0" />
        </button>
        <span
          className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] transition-opacity duration-300 ${
            saveVisible ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          aria-hidden={!saveVisible}
        >
          {savingStatus === "saving" ? (
            <>
              <StatusDot color="#FF5A36" pulse />
              <span className="font-mono fg-muted">Saving…</span>
            </>
          ) : (
            <>
              <StatusDot color="#10B981" />
              <span className="font-mono fg-muted">Saved · just now</span>
            </>
          )}
        </span>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2" />
      <div className="flex items-center gap-1">
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
            <div className="absolute right-0 mt-2 w-72 rounded-xl bg-elev border bd shadow-elev p-1.5 z-50 slide-down">
              <div className="px-2.5 pt-1.5 pb-2 text-[10px] uppercase tracking-wider fg-faint">
                Ship it
              </div>

              {published ? (
                <div className="rounded-md ring-1 ring-emerald-200 dark:ring-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 px-2.5 py-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="relative inline-flex h-2 w-2 shrink-0">
                      <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-70 animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <span className="min-w-0 text-[11.5px] font-semibold tracking-tight text-emerald-800 dark:text-emerald-300 truncate">
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

              {published && projectId && (
                <>
                  <div className="border-t bd my-1" />
                  <div className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-wider fg-faint flex items-center gap-1.5">
                    <HistoryIcon size={10} />
                    Previous deploys
                  </div>
                  {releasesLoading && (
                    <div className="px-2.5 py-1.5 text-[11px] fg-faint">
                      Loading…
                    </div>
                  )}
                  {!releasesLoading && releases && releases.length <= 1 && (
                    <div className="px-2.5 py-1.5 text-[11px] fg-faint">
                      No prior deploys yet.
                    </div>
                  )}
                  {!releasesLoading &&
                    releases &&
                    releases
                      .filter((r) => !r.isCurrent)
                      .slice(0, 9)
                      .map((r) => (
                        <button
                          key={r.sha}
                          type="button"
                          disabled={!!rollingSha}
                          onClick={() => void onRollbackClick(r.sha)}
                          className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-md hover:bg-hover transition group disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ring-1 ring-[color:var(--border)] bg-app fg-muted">
                            <RefreshCw size={10} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] font-mono fg truncate">
                              {r.sha}
                            </span>
                            <span className="block text-[10.5px] fg-faint">
                              {formatRelative(r.mtime)}
                            </span>
                          </span>
                          {rollingSha === r.sha && (
                            <span className="text-[10.5px] fg-faint">
                              Rolling back…
                            </span>
                          )}
                        </button>
                      ))}
                </>
              )}

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
        {canvasBreakpoints && canvasOnEditCondition && (
          <>
            <div className="inline-flex items-center gap-0.5 rounded-md border bd bg-elev p-0.5">
              {canvasBreakpoints.map((bp) => {
                const active = bp.name === activeBpName;
                return (
                  <button
                    key={bp.name}
                    type="button"
                    onClick={() =>
                      canvasOnEditCondition(
                        bp.name === "base"
                          ? null
                          : { kind: "breakpoint", bp: bp.name },
                      )
                    }
                    title={`@ ${bp.name} · min-width ${bp.minWidth}px`}
                    className={`h-6 px-2 text-[10.5px] font-medium rounded transition ui-small ${
                      active
                        ? "bg-[color:var(--accent)] text-white"
                        : "fg-faint hover:fg"
                    }`}
                  >
                    {bp.name}
                  </button>
                );
              })}
              {canvasOnAddBp && (
                <div className="relative" ref={bpRef}>
                  <button
                    type="button"
                    onClick={() => setBpOpen((o) => !o)}
                    title="Agregar breakpoint"
                    aria-label="Agregar breakpoint"
                    className="h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition"
                  >
                    +
                  </button>
                  {bpOpen && (
                    <div className="absolute left-0 mt-2 w-60 rounded-xl bg-elev border bd shadow-elev p-2 z-40 slide-down">
                      <div className="px-1.5 pt-0.5 pb-1.5 text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold">
                        Preset
                      </div>
                      {[
                        { name: "sm", minWidth: 480 },
                        { name: "md", minWidth: 768 },
                        { name: "lg", minWidth: 1024 },
                        { name: "xl", minWidth: 1440 },
                      ].map((p) => {
                        const exists = canvasBreakpoints.some(
                          (b) => b.name === p.name,
                        );
                        return (
                          <button
                            key={p.name}
                            type="button"
                            disabled={exists}
                            onClick={() => {
                              canvasOnAddBp(p.name, p.minWidth);
                              setBpOpen(false);
                            }}
                            className="w-full flex items-center gap-2 h-7 px-2 rounded text-[11.5px] fg-muted hover:fg hover:bg-hover transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                          >
                            <span className="font-mono fg">{p.name}</span>
                            <span className="ml-auto fg-faint tabular text-[10.5px]">
                              {p.minWidth}px
                              {exists ? " · existe" : ""}
                            </span>
                          </button>
                        );
                      })}
                      <div className="border-t bd my-2" />
                      <div className="px-1.5 pb-1 text-[9.5px] uppercase tracking-[0.14em] fg-faint font-semibold">
                        Custom
                      </div>
                      <div className="px-0.5 space-y-1.5">
                        <input
                          type="text"
                          value={bpCustomName}
                          onChange={(e) => setBpCustomName(e.target.value)}
                          placeholder="Nombre (ej: 2xl)"
                          className="w-full h-7 rounded-md bg-app border bd text-[11.5px] fg px-2 outline-none focus:border-[color:var(--accent)] placeholder:fg-faint"
                        />
                        <input
                          type="number"
                          value={bpCustomWidth}
                          onChange={(e) => setBpCustomWidth(e.target.value)}
                          placeholder="min-width (px)"
                          className="w-full h-7 rounded-md bg-app border bd text-[11.5px] fg font-mono px-2 outline-none focus:border-[color:var(--accent)] placeholder:fg-faint"
                        />
                        <button
                          type="button"
                          disabled={
                            !bpCustomName.trim() ||
                            !bpCustomWidth ||
                            canvasBreakpoints.some(
                              (b) => b.name === bpCustomName.trim(),
                            )
                          }
                          onClick={() => {
                            const w = Number(bpCustomWidth);
                            if (!Number.isFinite(w) || w < 0) return;
                            canvasOnAddBp(bpCustomName.trim(), w);
                            setBpCustomName("");
                            setBpCustomWidth("");
                            setBpOpen(false);
                          }}
                          className="w-full h-7 rounded-md bg-[color:var(--accent)] text-white text-[11px] font-medium hover:brightness-105 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Agregar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <span className="hidden md:inline-block h-5 w-px bg-[color:var(--border)] mx-0.5" />
          </>
        )}
        {canvasUndo && canvasRedo && (
          <>
            <IconBtn
              label="Deshacer (⌘Z)"
              size="sm"
              disabled={!canvasCanUndo}
              onClick={canvasUndo}
            >
              <Undo2 size={13} />
            </IconBtn>
            <IconBtn
              label="Rehacer (⌘⇧Z)"
              size="sm"
              disabled={!canvasCanRedo}
              onClick={canvasRedo}
            >
              <Redo2 size={13} />
            </IconBtn>
            <span className="hidden md:inline-block h-5 w-px bg-[color:var(--border)] mx-0.5" />
          </>
        )}
        <CreditPill />
        <IconBtn label={dark ? "Light mode" : "Dark mode"} onClick={onToggleDark}>
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </IconBtn>
        <div className="relative" ref={profRef}>
          <button
            type="button"
            onClick={() => setProfileOpen((o) => !o)}
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white text-[11.5px] font-semibold ring-1 ring-white/30 hover:brightness-110 transition"
          >
            J
            <span
              className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-[color:var(--bg)]"
              aria-hidden
            />
          </button>
          {profileOpen && (
            <div className="absolute right-0 mt-2 w-52 rounded-xl bg-elev border bd shadow-elev p-1 z-40 slide-down">
              <div className="px-2.5 py-2 border-b bd">
                <div className="text-[12.5px] font-medium fg">Jesus B.</div>
                <div className="text-[11px] fg-faint">jose12cheti12@gmail.com</div>
              </div>
              <a
                href="/projects"
                className="flex items-center justify-between w-full text-left px-2.5 py-1.5 rounded-md text-[13px] fg hover:bg-hover transition"
              >
                <span>All projects</span>
                <ExternalLink size={11} className="fg-faint" />
              </a>
              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  void signOut({ callbackUrl: "/login" });
                }}
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

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
