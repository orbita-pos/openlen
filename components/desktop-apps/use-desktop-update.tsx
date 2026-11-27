"use client";

// THE NEW-VERSION NOTICE (spec local 2026-11-26-apps-en-el-escritorio, §4.4). The window shows a FROZEN release; when the
// project's files moved on since it was installed it says so, and the person updates it with one button — nothing changes on
// its own. The question is asked on opening and whenever the window becomes visible again (never on a timer); «Actualizar»
// runs the install again through the same gates as the Publicar menu's. A gate that wants something (the security review's
// 428, a data change's, a build that doesn't compile) is NOT resolved here: the dialogs live in the workspace, so the strip
// says what is going on and links to the project, and the version that was running keeps running.
//
// It lives apart from the window so its guards (one update at a time, an answer to an old question says nothing about now)
// can be driven directly, not only through a button.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createStateProbe } from "@/lib/desktop-apps/state-probe";

export interface UpdateSource {
  frameUrl: string;
  projectId: string;
  /** The version the frame shows. */
  releaseSha: string;
  locale: string;
}

type StopReason = "security" | "securityPending" | "confirm" | "problem" | "failed";
export type UpdatePhase = { kind: "idle" } | { kind: "updating" } | { kind: "stopped"; reason: StopReason };

/** Why the install said no (the codes are the gates': `lib/tools/install-core.ts`, `publish-through-gates.ts`). */
export function stopReason(status: number, error: unknown): StopReason {
  if (status === 428) return error === "security_findings" ? "security" : error === "security_review_pending" ? "securityPending" : "confirm";
  return status === 422 ? "problem" : "failed";
}

/** The frame's address for another release: `toolFrameUrl` keeps the version in `?v=`. */
export function withRelease(frameUrl: string, releaseSha: string): string {
  const v = `v=${encodeURIComponent(releaseSha)}`;
  if (/[?&]v=/.test(frameUrl)) return frameUrl.replace(/([?&])v=[^&#]*/, (_match, separator: string) => `${separator}${v}`);
  return `${frameUrl}${frameUrl.includes("?") ? "&" : "?"}${v}`;
}

export interface DesktopUpdate {
  frameUrl: string;
  releaseSha: string;
  available: boolean;
  /** The project also has a published site: «Actualizar» migrates the production data that site shares (spec §5). */
  published: boolean;
  phase: UpdatePhase;
  update: () => Promise<void>;
}

type StateBody = { updateAvailable?: unknown; published?: unknown; desktopApp?: { releaseSha?: unknown } | null } | null;

export function useDesktopUpdate(p: UpdateSource): DesktopUpdate {
  const [shown, setShown] = useState({ frameUrl: p.frameUrl, releaseSha: p.releaseSha });
  const [available, setAvailable] = useState(false);
  const [published, setPublished] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const alive = useRef(true);
  const updating = useRef(false);
  /** How many updates have landed: an answer to a question asked before the last one says nothing about now. */
  const landed = useRef(0);
  /** The release the frame runs now (what an answer is compared with: it moves when an update lands). */
  const running = useRef(p.releaseSha);
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

  const check = useCallback(
    async (onFocus: boolean) => {
      if (updating.current) return;
      const epoch = landed.current;
      const asked = onFocus ? probe.askOnFocus() : probe.ask();
      if (!asked) return;
      try {
        const body = await asked;
        // An answer with no news (the server's no, or no body) leaves what the strip says as it was.
        if (!body || !alive.current || updating.current || landed.current !== epoch) return;
        // Two ways to be behind: the project moved on since the install, or the install moved on since this frame (the person
        // updated from the workspace, where a gate that stopped «Actualizar» sent them). Either way only the strip says so.
        const installed = body.desktopApp?.releaseSha;
        const now = body.updateAvailable === true || (typeof installed === "string" && installed !== "" && installed !== running.current);
        setAvailable(now);
        setPublished(body.published === true);
        // What had stopped an earlier press says nothing about a version that is no longer there.
        if (!now) setPhase({ kind: "idle" });
      } catch {
        // No answer — offline, or too slow — is no notice: the window works the same, and a notice already up stays up.
      }
    },
    [probe],
  );

  useEffect(() => {
    alive.current = true;
    void check(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check(true);
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

export function UpdateNotice({ phase, shared, onUpdate, openHref }: { phase: UpdatePhase; shared: boolean; onUpdate: () => void; openHref: string }) {
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
