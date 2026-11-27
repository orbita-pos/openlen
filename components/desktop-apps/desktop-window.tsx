"use client";

// THE WINDOW OF AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §4.3): `/desktop/<id>`, what the browser
// opens when the person installs the app and launches it. The frozen release fills the window in a frame on its own private
// host (isolated like the canvas — never on openlen.com); above it, OpenLen's thin strip («Acerca de», and the place of
// the new-version notice); and, outside the installed window, the «Instalar» card.
//
// An ordinary app gets NO bridge: with the person's session `window.openlen` would read their other projects. A TOOL on the
// desktop does — its caller is the person's installation of it — through the same `ToolFrame` the workspace frames a tool in
// (OpenLen's own confirmations, file picker and job lines included), with the workspace's colours as its theme, light or dark
// as this window's.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { ALLOW_REMOTO, SANDBOX_REMOTO } from "@/components/workspace-v2/sandbox-del-lienzo";
import { ToolFrame } from "@/components/workspace-v2/tools/tool-frame";
import { EARLY_INSTALL_PROMPT_KEY } from "@/lib/desktop-apps/early-install-prompt";
import type { ToolContext } from "@/lib/tools/bridge/protocol";
import { WORKSPACE_TOOL_THEME } from "@/lib/tools/bridge/workspace-theme";

export interface DesktopWindowProps {
  name: string;
  frameUrl: string;
  frameOrigin: string;
  projectId: string;
  /** The version the frame shows. */
  releaseSha: string;
  /** The person's installation of the tool this app is, or null for an ordinary app. */
  toolInstallationId: string | null;
  installedAt: string;
  locale: string;
  /** For a tool's context (`person.name`). */
  personName: string;
}

type InstallPromptEvent = Event & { prompt(): Promise<void> };

/** How long the browser has to offer before the card says how to install it by hand. */
const MANUAL_AFTER_MS = 1500;

const DISPLAY_MODES = ["standalone", "minimal-ui", "window-controls-overlay"] as const;

function isInstalledWindow(): boolean {
  if (typeof window.matchMedia === "function" && DISPLAY_MODES.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)) return true;
  return (navigator as { standalone?: boolean }).standalone === true;
}

/** The workspace's tokens for a tool outside the workspace's own page, light or dark as this window (the `dark` class on
 *  <html>, set before the first paint). The font is the window's own. */
function desktopToolTheme(): ToolContext["theme"] {
  const mode = document.documentElement.classList.contains("dark") ? "dark" : "light";
  const font = getComputedStyle(document.querySelector(".workspace-v2") ?? document.body).fontFamily;
  return { mode, tokens: { ...WORKSPACE_TOOL_THEME[mode], ...(font ? { "--font-sans": font } : {}) } };
}

const BUTTON =
  "inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]";

function InstallCard({ name }: { name: string }) {
  const t = useTranslations("wsChrome.desktop");
  // waiting: the browser may still be about to offer; prompt: it did; manual: it didn't; hidden: nothing to say.
  const [offer, setOffer] = useState<"waiting" | "prompt" | "manual" | "hidden">("waiting");
  const prompt = useRef<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (isInstalledWindow()) {
      setOffer("hidden");
      return;
    }
    const keep = (e: InstallPromptEvent) => {
      prompt.current = e;
      setOffer((prev) => (prev === "hidden" ? prev : "prompt"));
    };
    const early = (window as unknown as Record<string, InstallPromptEvent | undefined>)[EARLY_INSTALL_PROMPT_KEY];
    if (early) keep(early);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      keep(e as InstallPromptEvent);
    };
    const onInstalled = () => setOffer("hidden");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const timer = setTimeout(() => setOffer((prev) => (prev === "waiting" ? "manual" : prev)), MANUAL_AFTER_MS);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (offer === "waiting" || offer === "hidden") return null;

  const install = () => {
    const event = prompt.current;
    prompt.current = null;
    delete (window as unknown as Record<string, unknown>)[EARLY_INSTALL_PROMPT_KEY];
    // The browser's own dialog takes it from here; an event can only be used once.
    setOffer("hidden");
    void event?.prompt().catch(() => {});
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-4">
      <div className="bg-elev bd shadow-elev pointer-events-auto w-full max-w-md rounded-xl border p-4" data-desktop-install={offer}>
        <p className="fg text-[14px] font-semibold">{t("install.title", { name })}</p>
        <p className="fg-muted mt-1 text-[12.5px] leading-relaxed">{offer === "prompt" ? t("install.body") : t("install.manual")}</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className={`${BUTTON} fg-muted hover:bg-hover`} onClick={() => setOffer("hidden")}>
            {t("install.later")}
          </button>
          {offer === "prompt" ? (
            <button type="button" className={`${BUTTON} bg-[var(--accent-strong)] text-white hover:opacity-90`} onClick={install}>
              {t("install.button")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The project in OpenLen, where the gates' dialogs live («Acerca de» and a stopped update both go there). */
const openInOpenLenHref = (p: Pick<DesktopWindowProps, "locale" | "projectId">) => `/${p.locale}/new?project=${encodeURIComponent(p.projectId)}`;

// THE NEW-VERSION NOTICE (spec §4.4). The window shows a FROZEN release; when the project's files moved on since it was
// installed it says so, and the person updates it with one button — nothing changes on its own. The question is asked on
// opening and whenever the window becomes visible again (never on a timer); «Actualizar» runs the install again through
// the same gates as the Publicar menu's. A gate that wants something (the security review's 428, a data change's, a
// build that doesn't compile) is NOT resolved here: the dialogs live in the workspace, so the strip says what is going on
// and links to the project, and the version that was running keeps running.
type StopReason = "security" | "securityPending" | "confirm" | "problem" | "failed";
type UpdatePhase = { kind: "idle" } | { kind: "updating" } | { kind: "stopped"; reason: StopReason };

/** Why the install said no (the codes are the gates': `lib/tools/install-core.ts`, `publish-through-gates.ts`). */
function stopReason(status: number, error: unknown): StopReason {
  if (status === 428) return error === "security_findings" ? "security" : error === "security_review_pending" ? "securityPending" : "confirm";
  return status === 422 ? "problem" : "failed";
}

/** The frame's address for another release: `toolFrameUrl` keeps the version in `?v=`. */
function withRelease(frameUrl: string, releaseSha: string): string {
  const v = `v=${encodeURIComponent(releaseSha)}`;
  if (/[?&]v=/.test(frameUrl)) return frameUrl.replace(/([?&])v=[^&#]*/, (_match, separator: string) => `${separator}${v}`);
  return `${frameUrl}${frameUrl.includes("?") ? "&" : "?"}${v}`;
}

function useDesktopUpdate(p: DesktopWindowProps) {
  const [shown, setShown] = useState({ frameUrl: p.frameUrl, releaseSha: p.releaseSha });
  const [available, setAvailable] = useState(false);
  /** The project also has a published site: «Actualizar» migrates the production data that site shares (spec §5). */
  const [published, setPublished] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const alive = useRef(true);
  const asking = useRef(false);
  const updating = useRef(false);
  /** How many updates have landed: an answer to a question asked before the last one says nothing about now. */
  const landed = useRef(0);
  /** The release the frame runs now (what an answer is compared with: it moves when an update lands). */
  const running = useRef(p.releaseSha);
  const endpoint = `/api/projects/${encodeURIComponent(p.projectId)}/desktop`;

  const check = useCallback(async () => {
    if (asking.current || updating.current) return;
    asking.current = true;
    const epoch = landed.current;
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { updateAvailable?: unknown; published?: unknown; desktopApp?: { releaseSha?: unknown } | null } | null;
      if (!alive.current || updating.current || landed.current !== epoch) return;
      // Two ways to be behind: the project moved on since the install, or the install moved on since this frame (the person
      // updated from the workspace, where a gate that stopped «Actualizar» sent them). Either way only the strip says so.
      const installed = body?.desktopApp?.releaseSha;
      const now = body?.updateAvailable === true || (typeof installed === "string" && installed !== "" && installed !== running.current);
      setAvailable(now);
      setPublished(body?.published === true);
      // What had stopped an earlier press says nothing about a version that is no longer there.
      if (!now) setPhase({ kind: "idle" });
    } catch {
      // No answer is no notice: the window works the same offline.
    } finally {
      asking.current = false;
    }
  }, [endpoint]);

  useEffect(() => {
    alive.current = true;
    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  const update = useCallback(async () => {
    if (updating.current) return;
    updating.current = true;
    setPhase({ kind: "updating" });
    try {
      // The locale and nothing else: the gates' answers (their fingerprints, their confirmations) are the workspace's.
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: p.locale }) });
      const body = (await res.json().catch(() => null)) as { desktopApp?: { releaseSha?: unknown }; error?: unknown } | null;
      if (!alive.current) return;
      const releaseSha = body?.desktopApp?.releaseSha;
      if (res.ok && typeof releaseSha === "string" && releaseSha) {
        landed.current += 1;
        running.current = releaseSha;
        // The frame is keyed by its address: a new one is a new document, the new release.
        setShown((prev) => ({ frameUrl: withRelease(prev.frameUrl, releaseSha), releaseSha }));
        setAvailable(false);
        setPhase({ kind: "idle" });
      } else {
        setPhase({ kind: "stopped", reason: res.ok ? "failed" : stopReason(res.status, body?.error) });
      }
    } catch {
      if (alive.current) setPhase({ kind: "stopped", reason: "failed" });
    } finally {
      updating.current = false;
    }
  }, [endpoint, p.locale]);

  return { ...shown, available, published, phase, update };
}

function UpdateNotice({ phase, shared, onUpdate, openHref }: { phase: UpdatePhase; shared: boolean; onUpdate: () => void; openHref: string }) {
  const t = useTranslations("wsChrome.desktop");
  const text = phase.kind === "stopped" ? t(`update.reason.${phase.reason}`) : t("update.available");
  return (
    <>
      <span className="fg min-w-0 truncate text-[12px]" title={text}>
        {text}
      </span>
      {phase.kind === "stopped" ? (
        <a className="text-link shrink-0 text-[12px] font-medium underline underline-offset-2" href={openHref} target="_blank" rel="noopener">
          {t("about.open")}
        </a>
      ) : null}
      {/* «Actualizar» is a one-tap install that migrates the SAME production the published site uses: say so beside it. */}
      {shared ? (
        <span className="fg-muted min-w-0 truncate text-[12px]" title={t("update.sharedWithSite")}>
          {t("update.sharedWithSite")}
        </span>
      ) : null}
      <button
        type="button"
        className="shrink-0 rounded bg-[var(--accent-strong)] px-2 py-0.5 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-ring)]"
        disabled={phase.kind === "updating"}
        onClick={onUpdate}
      >
        {phase.kind === "updating" ? t("update.updating") : t("update.button")}
      </button>
    </>
  );
}

function About({ p, onClose }: { p: DesktopWindowProps; onClose: () => void }) {
  const t = useTranslations("wsChrome.desktop");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const date = new Intl.DateTimeFormat(p.locale, { dateStyle: "medium" }).format(new Date(p.installedAt));
  return (
    <div className="bg-elev bd shadow-elev absolute right-2 top-full z-20 mt-1 w-72 rounded-xl border p-3" data-desktop-about role="dialog" aria-label={t("about.title")}>
      <p className="fg-faint text-[11px] font-medium uppercase tracking-wide">{t("about.title")}</p>
      <p className="fg mt-1 break-words text-[14px] font-semibold">{p.name}</p>
      <p className="fg-muted mt-2 text-[12.5px]">{t("about.madeBy")}</p>
      <p className="fg-muted text-[12.5px]">{t("about.installedOn", { date })}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <a
          className="text-link text-[12.5px] font-medium underline underline-offset-2"
          href={openInOpenLenHref(p)}
          target="_blank"
          rel="noopener"
        >
          {t("about.open")}
        </a>
        <button type="button" className={`${BUTTON} fg-muted hover:bg-hover`} onClick={onClose}>
          {t("about.close")}
        </button>
      </div>
    </div>
  );
}

export function DesktopWindow(p: DesktopWindowProps) {
  const t = useTranslations("wsChrome.desktop");
  const [aboutOpen, setAboutOpen] = useState(false);
  const closeAbout = useCallback(() => setAboutOpen(false), []);
  const version = useDesktopUpdate(p);
  return (
    <div className="workspace-v2 flex h-dvh w-full flex-col overflow-hidden" data-desktop-window>
      <header className="bg-elev bd relative flex h-7 shrink-0 items-center gap-3 border-b px-3" data-desktop-strip>
        <span className="fg max-w-[40%] truncate text-[12px] font-medium">{p.name}</span>
        {/* The new-version notice takes the strip's free space between the name and «Acerca de», and renders nothing when
            there is nothing to say. The place is always there, so a screen reader announces what comes into it. */}
        <div className="flex min-w-0 flex-1 items-center gap-2" data-desktop-notice-slot role="status">
          {version.available ? <UpdateNotice phase={version.phase} shared={version.published} onUpdate={() => void version.update()} openHref={openInOpenLenHref(p)} /> : null}
        </div>
        <button
          type="button"
          className="fg-muted hover:fg rounded px-1.5 py-0.5 text-[12px] hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          aria-expanded={aboutOpen}
          onClick={() => setAboutOpen((open) => !open)}
        >
          {t("about.button")}
        </button>
        {aboutOpen ? <About p={p} onClose={closeAbout} /> : null}
      </header>
      <div className="relative min-h-0 flex-1">
        {p.toolInstallationId ? (
          <ToolFrame
            key={version.frameUrl}
            src={version.frameUrl}
            frameOrigin={p.frameOrigin}
            caller={{ installationId: p.toolInstallationId }}
            context={{
              person: { name: p.personName, locale: p.locale },
              project: null,
              tool: { id: p.toolInstallationId, version: version.releaseSha },
              environment: "installed",
            }}
            onPrompt={null}
            title={p.name}
            theme={desktopToolTheme}
          />
        ) : (
          <iframe
            key={version.frameUrl}
            src={version.frameUrl}
            title={p.name}
            sandbox={SANDBOX_REMOTO}
            allow={ALLOW_REMOTO}
            className="h-full w-full border-0 bg-[var(--bg)]"
            data-desktop-frame
          />
        )}
        <InstallCard name={p.name} />
      </div>
    </div>
  );
}
