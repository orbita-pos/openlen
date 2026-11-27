"use client";

// THE NEW-VERSION NOTICE (spec local 2026-11-26-apps-en-el-escritorio, §4.4). The window shows a FROZEN release; when the
// project's files moved on since it was installed it says so, and the person updates it with one button — nothing changes on
// its own. The question is asked on opening and whenever the window becomes visible again (never on a timer, and at most once a
// minute: Claude's probe; a look inside the minute is deferred to its end, once and only while the window is visible, so
// whoever edits in the workspace and comes back at once still hears about it); «Actualizar» runs the install again through the same gates as the Publicar menu's. A gate that wants
// something (the security review's 428, a data change's, a build that doesn't compile) is NOT resolved here: the dialogs live
// in the workspace, so the strip says what is going on and links to the project, and the version that was running keeps running.
//
// It lives apart from the window so its guards (one update at a time, an answer to an old question says nothing about now,
// a removed app is never brought back) can be driven directly, not only through a button.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { failureAction, failureOf, type DesktopFailure } from "@/lib/desktop-apps/failure";
import { createStateProbe, PROBE_TIMEOUT_MS } from "@/lib/desktop-apps/state-probe";

export interface UpdateSource {
  /** The app's name as the window opened with it: it follows what the route reports (Claude's title follows its page). */
  name: string;
  frameUrl: string;
  projectId: string;
  /** The version the frame shows. */
  releaseSha: string;
  locale: string;
}

/** At most one fresh check of the installed release per this time, however fast the frame loads. */
export const FRESH_CHECK_FLOOR_MS = 2000;

/** The most a startup call waits for the version check: a question's deadline plus the floor between fresh checks. */
export const WHEN_CHECKED_TIMEOUT_MS = PROBE_TIMEOUT_MS + FRESH_CHECK_FLOOR_MS;

export type UpdatePhase = { kind: "idle" } | { kind: "updating" } | { kind: "stopped"; reason: DesktopFailure };

/** The frame's address for another release: `toolFrameUrl` keeps the version in `?v=`. */
export function withRelease(frameUrl: string, releaseSha: string): string {
  const v = `v=${encodeURIComponent(releaseSha)}`;
  if (/[?&]v=/.test(frameUrl)) return frameUrl.replace(/([?&])v=[^&#]*/, (_match, separator: string) => `${separator}${v}`);
  return `${frameUrl}${frameUrl.includes("?") ? "&" : "?"}${v}`;
}

export interface DesktopUpdate {
  /** What the window is called now. */
  name: string;
  frameUrl: string;
  releaseSha: string;
  available: boolean;
  /** The project also has a published site: «Actualizar» migrates the production data that site shares (spec §5). */
  published: boolean;
  phase: UpdatePhase;
  update: () => Promise<void>;
  /** The frame may be running another release than `releaseSha` (Claude's «mixed versions»): the route reported another
   *  installed release (until the window reloads), or the frame loaded and no check from after that load has named this
   *  release yet — which is also how the window STARTS, since the server-rendered frame may have loaded before hydration,
   *  where no listener saw it. The app has no permissions while this holds. */
  holdsTwoVersions: boolean;
  /** The frame's element fired `load` (any load: the first, the app reloading itself, a crash and back): it may have loaded
   *  the release installed NOW, which is not necessarily the window's. */
  frameLoaded: () => void;
  /** Resolves once the window knows which release its frame runs — the check after the last load named it, or the window
   *  holds two versions for good (another release installed, an in-window update) — or after `WHEN_CHECKED_TIMEOUT_MS`.
   *  Like Claude's preload chaining every call behind the manifest's `declare`: an app that asks at startup waits for the
   *  answer instead of hearing «unavailable». It resolves from an effect, after the render where `holdsTwoVersions` turned
   *  false, so whoever resumes already reads the real declared list; on the timeout it is still closed (failing closed). */
  whenChecked: () => Promise<void>;
}

type StateBody = { updateAvailable?: unknown; published?: unknown; desktopApp?: { releaseSha?: unknown; name?: unknown } | null } | null;

export function useDesktopUpdate(p: UpdateSource): DesktopUpdate {
  const [name, setName] = useState(p.name);
  const [shown, setShown] = useState({ frameUrl: p.frameUrl, releaseSha: p.releaseSha });
  const [available, setAvailable] = useState(false);
  const [published, setPublished] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const alive = useRef(true);
  const updating = useRef(false);
  /** The route said this app is no longer on the desktop: nothing more is asked or installed from this window. */
  const removed = useRef(false);
  /** How many updates have landed: an answer to a question asked before the last one says nothing about now. */
  const landed = useRef(0);
  /** The release the frame runs now (what an answer is compared with: it moves when an update lands). */
  const running = useRef(p.releaseSha);
  /** The route said the installed release is not the one this frame was given: a reload of the frame would run it. Sticky. */
  const [otherInstalled, setOtherInstalled] = useState(false);
  /** A load of the frame after its first one that no check after it has cleared yet (each load starts a new one). */
  const [loadUnchecked, setLoadUnchecked] = useState(true);
  const unchecked = useRef(true);
  /** Moves with every load: an answer to a question from before the last load says nothing about what it loaded. */
  const loadSerial = useRef(0);
  /** When the last fresh check went out, and the one trailing check a load inside the floor waits for. */
  const lastFreshAt = useRef(Number.NEGATIVE_INFINITY);
  const freshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endpoint = `/api/projects/${encodeURIComponent(p.projectId)}/desktop`;

  // Claude's probe: a deadline on every question, one request in flight for whoever asks, and the window being looked at again
  // asks at most once a minute (`lib/desktop-apps/state-probe.ts`). `null` is a question that was answered with no news.
  const probe = useMemo(
    () =>
      createStateProbe<StateBody>(async (signal) => {
        const res = await fetch(endpoint, { cache: "no-store", signal });
        return res.ok ? ((await res.json()) as StateBody) : null;
      }),
    [endpoint],
  );

  /** The name the route reports for the installation: nothing, or an empty one, leaves the window's as it is. */
  const adoptName = useCallback((reported: unknown) => {
    if (typeof reported === "string" && reported.trim() !== "") setName(reported);
  }, []);

  /** The one check that a focus inside the minute is deferred to (at the end of that minute, while the window is visible):
   *  a person who edits in the workspace and comes back within the minute hears about it then, not after leaving again. */
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTrailing = useCallback(() => {
    if (trailing.current !== null) clearTimeout(trailing.current);
    trailing.current = null;
  }, []);

  const check = useCallback(
    async (onFocus: boolean) => {
      if (updating.current || removed.current) return;
      const epoch = landed.current;
      const asked = onFocus ? probe.askOnFocus() : probe.ask();
      if (!asked) {
        // Skipped inside the minute: one trailing check, however many focuses came, and none while the window is hidden.
        if (trailing.current === null) {
          trailing.current = setTimeout(() => {
            trailing.current = null;
            if (alive.current && document.visibilityState === "visible") void check(true);
          }, probe.focusDelayMs());
        }
        return;
      }
      try {
        const body = await asked;
        // An answer with no news (the server's no, or no body) leaves what the strip says as it was.
        if (!body || !alive.current || updating.current || removed.current || landed.current !== epoch) return;
        // Two ways to be behind: the project moved on since the install, or the install moved on since this frame (the person
        // updated from the workspace, where a gate that stopped «Actualizar» sent them). Either way only the strip says so.
        const installed = body.desktopApp?.releaseSha;
        const elsewhere = typeof installed === "string" && installed !== "" && installed !== running.current;
        if (elsewhere) setOtherInstalled(true);
        const now = body.updateAvailable === true || elsewhere;
        setAvailable(now);
        setPublished(body.published === true);
        adoptName(body.desktopApp?.name);
        // What had stopped an earlier press says nothing about a version that is no longer there.
        if (!now) setPhase({ kind: "idle" });
      } catch {
        // No answer — offline, or too slow — is no notice: the window works the same, and a notice already up stays up.
      }
    },
    [probe, adoptName],
  );

  /** Clears the unchecked load when `asked` — a question from after the last load — names the running release. No answer, or
   *  one without a release, leaves the app without permissions (failing closed). */
  const confirmFrom = useCallback((asked: Promise<StateBody>) => {
    const serial = loadSerial.current;
    const epoch = landed.current;
    asked.then(
      (body) => {
        if (!alive.current || serial !== loadSerial.current || landed.current !== epoch) return;
        const installed = body?.desktopApp?.releaseSha;
        if (typeof installed !== "string" || installed === "") return;
        if (installed !== running.current) {
          setOtherInstalled(true);
          setAvailable(true);
        }
        unchecked.current = false;
        setLoadUnchecked(false);
      },
      () => {},
    );
  }, []);

  /** A fresh check, at most one per `FRESH_CHECK_FLOOR_MS`: inside the floor ONE trailing check waits for its end (never
   *  dropped — permissions stay closed until it answers). */
  const freshCheck = useCallback(() => {
    if (freshTimer.current !== null) return;
    const wait = lastFreshAt.current + FRESH_CHECK_FLOOR_MS - Date.now();
    const go = () => {
      freshTimer.current = null;
      if (!alive.current) return;
      lastFreshAt.current = Date.now();
      confirmFrom(probe.askFresh());
    };
    if (wait <= 0) go();
    else freshTimer.current = setTimeout(go, wait);
  }, [confirmFrom, probe]);

  /** Whether `whenChecked` may resolve now: set by the effect below after the render, cleared at once by a load. */
  const settled = useRef(false);
  const waiters = useRef(new Set<() => void>());
  // ONE wait for every call while a check is pending, with one timer — as Claude chains every call behind the one
  // `declare` — so a frame asking in a loop adds nothing but promises that all settle together.
  const pendingCheck = useRef<Promise<void> | null>(null);
  const whenChecked = useCallback(() => {
    if (settled.current || !alive.current) return Promise.resolve();
    if (pendingCheck.current) return pendingCheck.current;
    const wait = new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        waiters.current.delete(done);
        if (pendingCheck.current === wait) pendingCheck.current = null;
        resolve();
      };
      const timer = setTimeout(done, WHEN_CHECKED_TIMEOUT_MS);
      waiters.current.add(done);
    });
    pendingCheck.current = wait;
    return wait;
  }, []);
  // Two versions for good (another release installed, or an update landed in the window) wait for nothing: they last
  // until the window reloads, so the answer is «unavailable» now.
  const twoForGood = otherInstalled || shown.releaseSha !== p.releaseSha;
  const twoForGoodRef = useRef(twoForGood);
  twoForGoodRef.current = twoForGood;
  useEffect(() => {
    settled.current = !loadUnchecked || twoForGood;
    if (settled.current) [...waiters.current].forEach((done) => done());
  }, [loadUnchecked, twoForGood]);
  useEffect(() => {
    const pending = waiters.current;
    return () => [...pending].forEach((done) => done());
  }, []);

  const frameLoaded = useCallback(() => {
    loadSerial.current += 1;
    unchecked.current = true;
    if (!twoForGoodRef.current) settled.current = false;
    setLoadUnchecked(true);
    freshCheck();
  }, [freshCheck]);

  useEffect(() => {
    alive.current = true;
    void check(false);
    // The question on opening went out after hydration, so after any load the window missed: it is the first fresh check.
    lastFreshAt.current = Date.now();
    confirmFrom(probe.ask());
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        // A check that never answered is asked again when the person comes back, not left closed for good. First, so the
        // focus check shares its question instead of sending a second one.
        if (unchecked.current) freshCheck();
        void check(true);
      }
      // Leaving the window takes its deferred check with it: it asks again when the person comes back.
      else cancelTrailing();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      cancelTrailing();
      if (freshTimer.current !== null) clearTimeout(freshTimer.current);
      freshTimer.current = null;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check, cancelTrailing, confirmFrom, freshCheck, probe]);

  const update = useCallback(async () => {
    if (updating.current || removed.current) return;
    updating.current = true;
    setPhase({ kind: "updating" });
    try {
      // The locale, and that it is the window asking: the gates' answers (their fingerprints, their confirmations) are the
      // workspace's, and a window left open after the app was removed elsewhere must not bring it back (the route answers
      // `desktop_app_removed`, as Claude closes the window of an app that was uninstalled).
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: p.locale, fromWindow: true }),
      });
      const body = (await res.json().catch(() => null)) as { desktopApp?: { releaseSha?: unknown; name?: unknown }; error?: unknown } | null;
      if (!alive.current) return;
      const releaseSha = body?.desktopApp?.releaseSha;
      if (res.ok && typeof releaseSha === "string" && releaseSha) {
        landed.current += 1;
        running.current = releaseSha;
        // The frame is keyed by its address: a new one is a new document, the new release.
        setShown((prev) => ({ frameUrl: withRelease(prev.frameUrl, releaseSha), releaseSha }));
        adoptName(body?.desktopApp?.name);
        setAvailable(false);
        setPhase({ kind: "idle" });
      } else {
        const reason = res.ok ? "failed" : failureOf(res.status, body?.error);
        if (reason === "removed") {
          removed.current = true;
          // The strip keeps saying it, whatever a later question would have said.
          setAvailable(true);
        }
        setPhase({ kind: "stopped", reason });
      }
    } catch {
      if (alive.current) setPhase({ kind: "stopped", reason: "failed" });
    } finally {
      updating.current = false;
    }
  }, [endpoint, p.locale, adoptName]);

  return { name, ...shown, available, published, phase, update, holdsTwoVersions: otherInstalled || loadUnchecked, frameLoaded, whenChecked };
}

/** Where the strip's one action goes (`failureAction`): all in OpenLen, outside the window's own scope. */
export interface UpdateLinks {
  project: string;
  pricing: string;
  tools: string;
}

export function UpdateNotice({ phase, shared, onUpdate, links }: { phase: UpdatePhase; shared: boolean; onUpdate: () => void; links: UpdateLinks }) {
  const t = useTranslations("wsChrome.desktop");
  const stopped = phase.kind === "stopped" ? phase.reason : null;
  const action = stopped ? failureAction(stopped) : null;
  const linkClass = "text-link shrink-0 text-[12px] font-medium underline underline-offset-2";
  return (
    <>
      {stopped ? (
        // Claude's «Couldn't install {app}.» + the reason: two lines, never one inside the other.
        <span className="flex min-w-0 flex-col leading-snug">
          <span className="fg text-[12px] font-medium" data-desktop-failure-title>
            {t("update.failedTitle")}
          </span>
          <span className="fg-muted text-[12px]" data-desktop-failure-reason>
            {t(`update.reason.${stopped}`)}
          </span>
        </span>
      ) : (
        <span className="fg min-w-0 truncate text-[12px]" title={t("update.available")}>
          {t("update.available")}
        </span>
      )}
      {action ? (
        <a className={linkClass} href={links[action]} target="_blank" rel="noopener">
          {action === "pricing" ? t("planRequired.plans") : action === "tools" ? t("update.action.tools") : t("about.open")}
        </a>
      ) : null}
      {/* «Actualizar» is a one-tap install that migrates the SAME production the published site uses: say so beside it. */}
      {shared && stopped !== "removed" ? (
        <span className="fg-muted min-w-0 truncate text-[12px]" title={t("update.sharedWithSite")}>
          {t("update.sharedWithSite")}
        </span>
      ) : null}
      <button
        type="button"
        className="shrink-0 rounded bg-[var(--accent-strong)] px-2 py-0.5 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-ring)]"
        disabled={phase.kind === "updating" || stopped === "removed"}
        onClick={onUpdate}
      >
        {phase.kind === "updating" ? t("update.updating") : t("update.button")}
      </button>
    </>
  );
}
