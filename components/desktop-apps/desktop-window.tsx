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
//
// Both kinds get `window.openlenApp` (spec local 2026-11-27-notificaciones-del-escritorio), which carries nothing of OpenLen:
// the frame asks for permissions and shows notifications, and THIS window decides (`use-app-api-host.ts`), draws OpenLen's
// dialog, keeps the answers on the device and offers «Permisos» in the strip, next to «Acerca de».
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { ALLOW_REMOTO, SANDBOX_REMOTO } from "@/components/workspace-v2/sandbox-del-lienzo";
import { ToolFrame } from "@/components/workspace-v2/tools/tool-frame";
import { installBrowser } from "@/lib/desktop-apps/browser";
import { EARLY_INSTALL_PROMPT_KEY } from "@/lib/desktop-apps/early-install-prompt";
import { dismissInstallCard, installCardDismissed } from "@/lib/desktop-apps/install-later";
import type { DesktopPermission } from "@/lib/desktop-apps/permissions/declared";
import type { ToolContext } from "@/lib/tools/bridge/protocol";
import { WORKSPACE_TOOL_THEME } from "@/lib/tools/bridge/workspace-theme";

import { useAppApiHost } from "./use-app-api-host";
import { UpdateNotice, useDesktopUpdate } from "./use-desktop-update";

export interface DesktopWindowProps {
  /** The installation's id (the window's own address): what «Not now» on the install card is remembered under. */
  desktopId: string;
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
  /** The session's own id: the key its permission answers are saved under on this device. */
  personId: string;
  /** What the installed version's shell declares (`[]` may mean «not read»: it never deletes a saved answer). */
  declaredPermissions: DesktopPermission[];
  /** Why the app's manifest declared nothing, for its builder: the page's console, never the screen. */
  manifestWarning: string | null;
  /** `OPENLEN_DESKTOP_NOTIFICATIONS` is not `0`. */
  notificationsOn: boolean;
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

const NOTHING_DECLARED: DesktopPermission[] = [];

const BUTTON =
  "inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]";

function InstallCard({ name, desktopId }: { name: string; desktopId: string }) {
  const t = useTranslations("wsChrome.desktop");
  // waiting: the browser may still be about to offer; prompt: it did; manual: it didn't; hidden: nothing to say.
  const [offer, setOffer] = useState<"waiting" | "prompt" | "manual" | "hidden">("waiting");
  const prompt = useRef<InstallPromptEvent | null>(null);

  useEffect(() => {
    // Installed already, or the person said «Not now» to this app in this browser: nothing to ask.
    if (isInstalledWindow() || installCardDismissed(desktopId)) {
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
  }, [desktopId]);

  if (offer === "waiting" || offer === "hidden") return null;

  const install = () => {
    const event = prompt.current;
    prompt.current = null;
    delete (window as unknown as Record<string, unknown>)[EARLY_INSTALL_PROMPT_KEY];
    // The browser's own dialog takes it from here; an event can only be used once.
    setOffer("hidden");
    void event?.prompt().catch(() => {});
  };

  // Without the browser's offer the card says exactly where to install it in THIS browser (Claude says where the app went).
  const how = offer === "prompt" ? t("install.body") : t(`install.manual.${installBrowser(navigator.userAgent)}`);
  const notNow = () => {
    dismissInstallCard(desktopId);
    setOffer("hidden");
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-4">
      <div className="bg-elev bd shadow-elev pointer-events-auto w-full max-w-md rounded-xl border p-4" data-desktop-install={offer}>
        <p className="fg text-[14px] font-semibold">{t("install.title", { name })}</p>
        <p className="fg-muted mt-1 text-[12.5px] leading-relaxed">{how}</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className={`${BUTTON} fg-muted hover:bg-hover`} onClick={notNow}>
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
  const name = version.name;
  // The window's name follows the app, as Claude's title follows its page (the installed shortcut's name is the browser's).
  useEffect(() => {
    if (name !== p.name) document.title = name;
  }, [name, p.name]);
  const links = { project: openInOpenLenHref(p), pricing: `/${p.locale}/pricing`, tools: `/${p.locale}/new?view=tools` };
  // `window.openlenApp` in the frame asks; this window answers (spec local 2026-11-27-notificaciones-del-escritorio): with the
  // version the frame shows NOW. What the app declares was read for the version the page loaded with, so once another
  // version runs here the window holds two versions and, like Claude's, has no permissions until it reloads: `[]` makes
  // every one «unavailable» (it writes nothing — a saved answer stays for after the reload). The frame's address carries
  // its version, but the host serves the installation's CURRENT release whatever it says, and the frame never says which
  // it runs (it would be the app's word). So, like Claude tracking every content frame's version: an in-window update, the
  // route reporting another installed release, or the frame loading again (its element's `load`, which fires here even
  // cross-origin) until a check from after that load says the release is still this one — all take every permission.
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(new WeakMap<HTMLIFrameElement, number>());
  const frameReloaded = version.frameReloaded;
  const onFrameLoad = useCallback(
    (element: HTMLIFrameElement) => {
      const n = (loads.current.get(element) ?? 0) + 1;
      loads.current.set(element, n);
      if (n > 1) frameReloaded();
    },
    [frameReloaded],
  );
  const declared = version.releaseSha === p.releaseSha && !version.holdsTwoVersions ? p.declaredPermissions : NOTHING_DECLARED;
  const appApi = useAppApiHost({
    frame,
    frameOrigin: p.frameOrigin,
    personId: p.personId,
    installationId: p.desktopId,
    releaseSha: version.releaseSha,
    installedAt: p.installedAt,
    declared,
    notificationsOn: p.notificationsOn,
    appName: name,
    iconUrl: `/desktop/${encodeURIComponent(p.desktopId)}/icon`,
  });
  // For the app's builder, once per window, like Claude's `console.warn("claude-artifacts-manifest:", …)`.
  const warned = useRef(false);
  useEffect(() => {
    if (!p.manifestWarning || warned.current) return;
    warned.current = true;
    console.warn("openlen-app-manifest:", p.manifestWarning);
  }, [p.manifestWarning]);
  return (
    <div className="workspace-v2 flex h-dvh w-full flex-col overflow-hidden" data-desktop-window>
      {/* At least thin: a refusal says two lines (the headline and why), and the strip grows to hold them. */}
      <header className="bg-elev bd relative flex min-h-7 shrink-0 items-center gap-3 border-b px-3 py-0.5" data-desktop-strip>
        <span className="fg max-w-[40%] truncate text-[12px] font-medium">{name}</span>
        {/* The new-version notice takes the strip's free space between the name and «Acerca de», and renders nothing when
            there is nothing to say. The place is always there, so a screen reader announces what comes into it. */}
        <div className="flex min-w-0 flex-1 items-center gap-2" data-desktop-notice-slot role="status">
          {version.available ? <UpdateNotice phase={version.phase} shared={version.published} onUpdate={() => void version.update()} links={links} /> : null}
        </div>
        <button
          type="button"
          className="fg-muted hover:fg rounded px-1.5 py-0.5 text-[12px] hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          onClick={() => {
            setAboutOpen(false);
            appApi.openPermissions();
          }}
        >
          {t("permissions.button")}
        </button>
        <button
          type="button"
          className="fg-muted hover:fg rounded px-1.5 py-0.5 text-[12px] hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          aria-expanded={aboutOpen}
          onClick={() => setAboutOpen((open) => !open)}
        >
          {t("about.button")}
        </button>
        {aboutOpen ? <About p={{ ...p, name }} onClose={closeAbout} /> : null}
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
            title={name}
            theme={desktopToolTheme}
            frameRef={frame}
            onFrameLoad={onFrameLoad}
          />
        ) : (
          <iframe
            ref={frame}
            key={version.frameUrl}
            src={version.frameUrl}
            title={name}
            sandbox={SANDBOX_REMOTO}
            allow={ALLOW_REMOTO}
            className="h-full w-full border-0 bg-[var(--bg)]"
            onLoad={(e) => onFrameLoad(e.currentTarget)}
            data-desktop-frame
          />
        )}
        <InstallCard name={name} desktopId={p.desktopId} />
      </div>
      {appApi.dialog}
    </div>
  );
}
