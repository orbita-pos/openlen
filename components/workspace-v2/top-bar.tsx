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
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { signOut, useSession } from "next-auth/react";
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
  Volume2,
  VolumeX,
  X,
} from "./icons";
import { IconBtn, StatusDot } from "./ui";
import { useToast } from "./toast";
import { CreditPill } from "@/components/app/credit-pill";
import { OpenLenMark } from "@/components/openlen-logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { defaultLogoDataUrl } from "@/lib/branding/default-logo";

// Sound control — the speaker icon opens a small popover with a mute toggle +
// a volume slider (0–100%). Volume 0 = muted. Dragging the slider previews a
// click at the new level so the user can dial it in by ear.
function SoundControl({
  volume,
  onVolume,
  onToggleMute,
}: {
  volume: number;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
}) {
  const t = useTranslations("topbar");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const muted = volume === 0;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);
  const pct = Math.round(volume * 100);
  return (
    // data-no-sound: the global click listener skips this — the volume slider's
    // own setVolume preview is the only feedback here (avoids a double-click).
    <div className="relative" ref={ref} data-no-sound>

      <IconBtn
        label={muted ? t("sound.unmute") : t("sound.mute")}
        onClick={() => setOpen((o) => !o)}
      >
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </IconBtn>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 flex items-center gap-2 rounded-lg border bd bg-elev shadow-card px-2.5 py-2 w-44">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? t("sound.unmute") : t("sound.mute")}
            className="shrink-0 fg-muted hover:fg transition"
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            onChange={(e) => onVolume(Number(e.target.value) / 100)}
            aria-label={t("sound.volume")}
            className="flex-1 h-1 cursor-pointer accent-[color:var(--accent)]"
          />
          <span className="shrink-0 w-8 text-right text-[10px] fg-faint tabular-nums">
            {pct}%
          </span>
        </div>
      )}
    </div>
  );
}

interface ReleaseEntry {
  sha: string;
  mtime: string;
  isCurrent: boolean;
}

interface TopBarProps {
  projectName: string;
  onRename: (name: string) => void;
  /** Per-project favicon shown as a 16x16 icon next to the project name.
   *  Null = fall back to the coral initial-letter mark. */
  projectLogoUrl?: string | null;
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
  /** Open the custom-domain modal. Pass undefined to hide the entry
   *  point (no project loaded). */
  onCustomDomain?: () => void;
  /** Open the "Deploy to Vercel" modal. Undefined hides the entry. */
  onDeployVercel?: () => void;
  /** Open the "Push to GitHub" modal. Undefined hides the entry. */
  onDeployGitHub?: () => void;
  dark: boolean;
  onToggleDark: () => void;
  soundVolume: number;
  onSoundVolume: (v: number) => void;
  onToggleSoundMute: () => void;
}

export function TopBar({
  projectName,
  onRename,
  projectLogoUrl,
  projectLoading = false,
  savingStatus = null,
  onPublish,
  published,
  projectId,
  onRolledBack,
  onCustomDomain,
  onDeployVercel,
  onDeployGitHub,
  dark,
  onToggleDark,
  soundVolume,
  onSoundVolume,
  onToggleSoundMute,
}: TopBarProps) {
  const t = useTranslations("topbar");
  const toast = useToast();
  const locale = useLocale();
  const { data: session } = useSession();
  const userName = session?.user?.name ?? "";
  const userEmail = session?.user?.email ?? "";
  const userImage = session?.user?.image ?? null;
  // First-letter avatar fallback when Google didn't return a profile image
  // (or we want a uniform monogram). Pulls from name first, falls back to
  // the local-part of the email so newly-signed users without a name still
  // get a sensible initial.
  const avatarLetter = (
    (userName || userEmail.split("@")[0] || "?").trim().charAt(0) || "?"
  ).toUpperCase();
  // Short display name for the dropdown header. Trim a long Google "Family"
  // to first name + first letter of last to keep it on one line.
  const displayName = (() => {
    const n = userName.trim();
    if (!n) return userEmail || t("account.fallbackName");
    const parts = n.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
  })();
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
  const deployRef = useRef<HTMLDivElement>(null);
  const profRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(projectName);
  }, [projectName]);

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
    const ok = window.confirm(t("rollback.confirm", { sha }));
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
        toast.error(
          body.error === "release_gone"
            ? t("rollback.errorGone")
            : t("rollback.errorGeneric"),
        );
        return;
      }
      setDeployOpen(false);
      onRolledBack?.();
      toast.success(t("rollback.successTitle", { sha }), {
        description: t("rollback.successBody"),
      });
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
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 rounded-md -mx-1 px-1 py-0.5 hover:bg-hover transition"
        >
          <OpenLenMark className="h-7 w-7 shrink-0" />
          <span className="font-display text-[15px] tracking-tight hidden md:inline">
            Open<span className="text-coral-700 dark:text-coral-400">Len</span>
          </span>
        </Link>
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
                onRename(draft.trim() || t("projectName.untitled"));
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
              <span className="text-[13px] fg-muted whitespace-nowrap shrink-0">{t("projectName.workspaceLabel")}</span>
              <span className="fg-faint shrink-0">—</span>
              {projectLoading ? (
                <span className="text-[13px] font-medium fg-faint truncate animate-pulse">
                  {t("common.loading")}
                </span>
              ) : (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={projectLogoUrl || defaultLogoDataUrl(projectName)}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded object-contain"
                  />
                  <span className="text-[13px] font-medium fg truncate">
                    {projectName}
                  </span>
                </>
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
              <span className="font-mono fg-muted">{t("save.saving")}</span>
            </>
          ) : (
            <>
              <StatusDot color="#10B981" />
              <span className="font-mono fg-muted">{t("save.saved")}</span>
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
            aria-label={t("deploy.button")}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-md bg-[var(--accent-strong)] text-white text-[12px] font-medium hover:brightness-105 active:brightness-95 shadow-coral transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles size={12} />
            <span className="hidden sm:inline">{t("deploy.button")}</span>
            <ChevronDown
              size={11}
              className={`transition ${deployOpen ? "rotate-180" : ""}`}
            />
          </button>
          {deployOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-xl bg-elev border bd shadow-elev p-1.5 z-50 slide-down">
              <div className="px-2.5 pt-1.5 pb-2 text-[10px] uppercase tracking-wider fg-faint">
                {t("deploy.shipIt")}
              </div>

              {published ? (
                <div className="rounded-md ring-1 ring-emerald-200 dark:ring-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 px-2.5 py-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="relative inline-flex h-2 w-2 shrink-0">
                      <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-70 animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <span className="min-w-0 text-[11.5px] font-semibold tracking-tight text-emerald-800 dark:text-emerald-300 truncate">
                      {t("deploy.liveAt", { subdomain: published.subdomain })}
                    </span>
                  </div>
                  {published.hasUnpublishedChanges && (
                    <div className="mt-1 text-[10.5px] text-amber-700 dark:text-amber-300">
                      {t("deploy.unpublishedChanges")}
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
                        <ExternalLink size={10} /> {t("deploy.open")}
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
                          <RefreshCw size={10} /> {t("deploy.republish")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeployOpen(false);
                            onPublish();
                          }}
                          className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 transition"
                        >
                          <X size={10} /> {t("deploy.unpublish")}
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
                      {t("deploy.publishCta.title")}
                    </span>
                    <span className="block text-[11px] fg-faint">
                      {t("deploy.publishCta.subtitle")}
                    </span>
                  </span>
                  <ChevronRight size={12} className="fg-faint group-hover:text-[var(--accent)] transition" />
                </button>
              )}

              <div className="border-t bd my-1" />

              {/* Custom domain — real, working entry. Opens a modal that
                  handles the claim + DNS challenge + Caddy-issued TLS. */}
              {onCustomDomain && (
                <button
                  type="button"
                  onClick={() => {
                    setDeployOpen(false);
                    onCustomDomain();
                  }}
                  className="flex items-center gap-3 w-full text-left px-2.5 py-2 rounded-md hover:bg-hover transition group"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[var(--accent)]">
                    <Globe size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold tracking-tight fg">
                      {t("deploy.customDomain.title")}
                    </span>
                    <span className="block text-[11px] fg-faint">
                      {t("deploy.customDomain.subtitle")}
                    </span>
                  </span>
                  <ChevronRight size={12} className="fg-faint group-hover:text-[var(--accent)] transition" />
                </button>
              )}

              <div className="border-t bd my-1" />

              {(
                [
                  {
                    id: "vercel",
                    label: t("deploy.providers.vercel"),
                    subtitle: t("deploy.providers.vercelSubtitle"),
                    onClick: onDeployVercel,
                  },
                  {
                    id: "github",
                    label: t("deploy.providers.github"),
                    subtitle: t("deploy.providers.githubSubtitle"),
                    onClick: onDeployGitHub,
                  },
                ] as const
              )
                .filter((o) => o.onClick)
                .map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setDeployOpen(false);
                      o.onClick?.();
                    }}
                    className="flex items-center gap-3 w-full text-left px-2.5 py-2 rounded-md hover:bg-hover transition group"
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[var(--accent)]">
                      <Globe size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold tracking-tight fg">
                        {o.label}
                      </span>
                      <span className="block text-[11px] fg-faint">
                        {o.subtitle}
                      </span>
                    </span>
                    <ChevronRight
                      size={12}
                      className="fg-faint group-hover:text-[var(--accent)] transition"
                    />
                  </button>
                ))}

              {published && projectId && (
                <>
                  <div className="border-t bd my-1" />
                  <div className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-wider fg-faint flex items-center gap-1.5">
                    <HistoryIcon size={10} />
                    {t("deploy.previousDeploys")}
                  </div>
                  {releasesLoading && (
                    <div className="px-2.5 py-1.5 text-[11px] fg-faint">
                      {t("common.loading")}
                    </div>
                  )}
                  {!releasesLoading && releases && releases.length <= 1 && (
                    <div className="px-2.5 py-1.5 text-[11px] fg-faint">
                      {t("deploy.noPriorDeploys")}
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
                              {formatRelative(r.mtime, t)}
                            </span>
                          </span>
                          {rollingSha === r.sha && (
                            <span className="text-[10.5px] fg-faint">
                              {t("rollback.inProgress")}
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
        <CreditPill />
        <LocaleSwitcher />
        <IconBtn
          label={dark ? t("theme.lightMode") : t("theme.darkMode")}
          onClick={onToggleDark}
        >
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </IconBtn>
        <SoundControl
          volume={soundVolume}
          onVolume={onSoundVolume}
          onToggleMute={onToggleSoundMute}
        />
        <div className="relative" ref={profRef}>
          <button
            type="button"
            onClick={() => setProfileOpen((o) => !o)}
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white text-[11.5px] font-semibold ring-1 ring-white/30 hover:brightness-110 transition overflow-hidden"
            aria-label={displayName}
          >
            {userImage ? (
              // Google profile photo — eslint-disable-next-line because we
              // don't want next/image's domain-allowlist friction here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={userImage}
                alt=""
                width={32}
                height={32}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              avatarLetter
            )}
            <span
              className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-[color:var(--bg)]"
              aria-hidden
            />
          </button>
          {profileOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl bg-elev border bd shadow-elev p-1 z-40 slide-down">
              <div className="px-2.5 py-2 border-b bd">
                <div className="text-[12.5px] font-medium fg truncate">
                  {displayName}
                </div>
                <div className="text-[11px] fg-faint truncate">
                  {userEmail || "—"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  void signOut({ callbackUrl: `/${locale}/login` });
                }}
                className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-md text-[13px] fg hover:bg-hover transition"
              >
                {t("account.signOut")}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function formatRelative(
  iso: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return t("relativeTime.seconds", { count: sec });
  const min = Math.round(sec / 60);
  if (min < 60) return t("relativeTime.minutes", { count: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t("relativeTime.hours", { count: hr });
  const day = Math.round(hr / 24);
  if (day < 30) return t("relativeTime.days", { count: day });
  return new Date(iso).toLocaleDateString();
}
