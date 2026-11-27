"use client";

// THE WINDOW ANSWERS THE FRAME (spec local 2026-11-27-notificaciones-del-escritorio, §4.2–4.6, §7): `window.openlenApp`
// (`lib/desktop-apps/app-api/client-source.ts`, in the app's frame) only ASKS; this hook, in the window (openlen.com), is the one
// that decides — the only real security boundary, because the frame is the app's and can post anything by hand.
//   · a message counts only from the frame's own window (`event.source === iframe.contentWindow`) AND its origin, and only in
//     the protocol's shape; every argument goes through the protocol's validators; the answer goes back to that window at
//     that origin, never «*»;
//   · `request()` waits until the window is visible and focused, then draws OpenLen's dialog (`permission-dialog.tsx`), ONE
//     at a time; at most 8 more wait behind it. «Allow» saves a «yes» for the CURRENT version and installation and asks the
//     browser in that same click; «Don't allow» or Escape saves a «no» for good; the window hidden, or a new version landing,
//     closes it saving nothing (Claude's `d = !l && s()`);
//   · `manage()` opens «Permisos» only with a real gesture in the window (`navigator.userActivation.isActive`: a click in the
//     child frame activates its ancestors) and the window visible;
//   · `show()` never asks: without the effective permission it is EPERM. It is the window's `new Notification(appName, { body,
//     icon, tag: installationId })` — one at a time per app, as Claude's — whose click focuses the window and tells the app
//     nothing; at most one a second.
// The answers live on the device (`localGrantStore`); the browser's own permission is read, never stored as the app's.
import { createElement, Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import {
  appApiFail,
  appApiOk,
  isAppApiRequest,
  parseRequestArgs,
  parseShowArgs,
  parseStateArgs,
  type AppApiRequest,
  type AppApiResponse,
} from "@/lib/desktop-apps/app-api/protocol";
import { DESKTOP_PERMISSIONS, type DesktopPermission } from "@/lib/desktop-apps/permissions/declared";
import { grantKey, isReask, localGrantStore, permissionState, type GrantStore, type PermissionState } from "@/lib/desktop-apps/permissions/grants";

import { PermissionDialog } from "./permission-dialog";
import { PermissionsPanel } from "./permissions-panel";

export interface AppApiHostInput {
  frame: RefObject<HTMLIFrameElement | null>;
  frameOrigin: string;
  personId: string;
  /** The installation's id (the window's `/desktop/<id>`): the grants' key and the notification's `tag`. */
  installationId: string;
  /** The version the frame shows NOW (after an in-window update, the new one). */
  releaseSha: string;
  installedAt: string;
  declared: DesktopPermission[];
  notificationsOn: boolean;
  appName: string;
  iconUrl: string;
  store?: GrantStore;
  NotificationCtor?: typeof Notification;
}

/** The most `request()`s that wait behind the open dialog (a frame can post them in a loop). */
export const MAX_WAITING_REQUESTS = 8;
/** At most one notification in this time; the rest are refused. */
export const SHOW_INTERVAL_MS = 1000;
/** While a dialog waits for the window to be in front, how often it looks (focus moving into the frame fires nothing here). */
const ATTENDED_POLL_MS = 500;

type Ask = { permission: DesktopPermission; done: () => void };

const attended = () => document.visibilityState === "visible" && document.hasFocus();

/** Phones and tablets have a `Notification` that can't be constructed (Android Chrome throws; iOS needs a service worker). */
function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1; // iPadOS says it is a Mac
}

export function useAppApiHost(i: AppApiHostInput): { dialog: ReactNode; openPermissions(): void } {
  const latest = useRef(i);
  latest.current = i;
  const store = useMemo(() => i.store ?? localGrantStore(), [i.store]);
  const storeRef = useRef(store);
  storeRef.current = store;

  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const [asking, setAsking] = useState<{ permission: DesktopPermission; reask: boolean } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const queue = useRef<Ask[]>([]);
  const active = useRef<Ask | null>(null);
  const stopWaiting = useRef<(() => void) | null>(null);
  const lastShown = useRef(Number.NEGATIVE_INFINITY);
  const alive = useRef(true);

  const ctor = useCallback((): typeof Notification | undefined => {
    const c = latest.current.NotificationCtor ?? (globalThis as { Notification?: typeof Notification }).Notification;
    return typeof c === "function" && !isMobile() ? c : undefined;
  }, []);
  const browser = useCallback((): NotificationPermission => {
    const p = ctor()?.permission;
    return p === "granted" || p === "denied" ? p : "default";
  }, [ctor]);

  const rowOf = useCallback((permission: DesktopPermission) => {
    const cur = latest.current;
    return storeRef.current.get(grantKey(cur.personId, cur.installationId, permission));
  }, []);

  const stateOf = useCallback(
    (permission: DesktopPermission): PermissionState => {
      const cur = latest.current;
      return permissionState({
        permission,
        declared: cur.declared,
        switchOn: cur.notificationsOn,
        notificationsSupported: ctor() !== undefined,
        browser: browser(),
        row: rowOf(permission),
        releaseSha: cur.releaseSha,
        installedAt: cur.installedAt,
      });
    },
    [browser, ctor, rowOf],
  );
  const stateMap = useCallback(
    () => Object.fromEntries(DESKTOP_PERMISSIONS.map((p) => [p, stateOf(p)])) as Record<DesktopPermission, PermissionState>,
    [stateOf],
  );

  const cancelWaiting = () => {
    stopWaiting.current?.();
    stopWaiting.current = null;
  };

  /** Calls `then` once the window is visible and focused (now, if it is). */
  const whenAttended = useCallback((then: () => void) => {
    cancelWaiting();
    if (attended()) return then();
    const check = () => {
      if (!attended()) return;
      cancelWaiting();
      then();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    const timer = setInterval(check, ATTENDED_POLL_MS);
    stopWaiting.current = () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      clearInterval(timer);
    };
  }, []);

  const finish = useCallback((ask: Ask) => {
    if (active.current !== ask) return;
    active.current = null;
    setAsking(null);
    ask.done();
    pumpRef.current();
  }, []);

  /** Shows the active ask's dialog when the window is in front — unless it was answered meanwhile (another dialog, Permisos). */
  const present = useCallback(
    (ask: Ask) => {
      whenAttended(() => {
        if (!alive.current || active.current !== ask) return;
        if (stateOf(ask.permission) !== "prompt") return finish(ask);
        const cur = latest.current;
        setAsking({ permission: ask.permission, reask: isReask(rowOf(ask.permission), cur.releaseSha, cur.installedAt) });
      });
    },
    [finish, rowOf, stateOf, whenAttended],
  );

  const pump = useCallback(() => {
    if (!alive.current || active.current) return;
    const next = queue.current.shift();
    if (!next) return;
    active.current = next;
    present(next);
  }, [present]);
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  // The window hidden while the dialog is up closes it, saving nothing; back in front, it asks again (the request is alive).
  useEffect(() => {
    const onVisibility = () => {
      refresh(); // the browser's permission may have changed in its settings meanwhile
      const ask = active.current;
      if (!ask || document.visibilityState === "visible") return;
      setAsking(null);
      present(ask);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [present, refresh]);

  // A new version (or installation) landed in the window: the frame that asked is gone. Whatever was open closes without
  // saving and every waiting request is answered with the map as it is now.
  const marks = `${i.releaseSha}\n${i.installedAt}`;
  const previousMarks = useRef(marks);
  useEffect(() => {
    if (previousMarks.current === marks) return;
    previousMarks.current = marks;
    cancelWaiting();
    setAsking(null);
    const pending = [...(active.current ? [active.current] : []), ...queue.current];
    active.current = null;
    queue.current = [];
    for (const ask of pending) ask.done();
  }, [marks]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelWaiting();
    };
  }, []);

  const save = useCallback(
    (permission: DesktopPermission, answer: "granted" | "denied") => {
      const cur = latest.current;
      const key = grantKey(cur.personId, cur.installationId, permission);
      storeRef.current.set(key, answer === "granted" ? { answer, releaseSha: cur.releaseSha, installedAt: cur.installedAt } : { answer });
      refresh();
    },
    [refresh],
  );

  /** In the click itself (the browser's prompt needs the gesture): ask the browser, only when it hasn't been asked. */
  const askBrowser = useCallback(
    (permission: DesktopPermission): Promise<unknown> => {
      const c = ctor();
      if (permission !== "notifications" || !c || browser() !== "default") return Promise.resolve();
      try {
        return Promise.resolve(c.requestPermission()).catch(() => undefined);
      } catch {
        return Promise.resolve();
      }
    },
    [browser, ctor],
  );

  const allow = useCallback(() => {
    const ask = active.current;
    if (!ask) return;
    save(ask.permission, "granted");
    const asked = askBrowser(ask.permission);
    setAsking(null);
    void asked.then(() => {
      refresh();
      finish(ask);
    });
  }, [askBrowser, finish, refresh, save]);

  const deny = useCallback(() => {
    const ask = active.current;
    if (!ask) return;
    save(ask.permission, "denied");
    finish(ask);
  }, [finish, save]);

  const toggle = useCallback(
    (permission: DesktopPermission, on: boolean) => {
      save(permission, on ? "granted" : "denied");
      if (on) void askBrowser(permission).then(refresh);
    },
    [askBrowser, refresh, save],
  );

  const handle = useCallback(
    async (req: AppApiRequest): Promise<AppApiResponse> => {
      const { id } = req;
      switch (req.method) {
        case "permissions.state": {
          const args = parseStateArgs(req.args);
          if ("code" in args) return appApiFail(id, args.code, args.message);
          return appApiOk(id, args.name ? stateOf(args.name) : stateMap());
        }
        case "permissions.request": {
          const args = parseRequestArgs(req.args);
          if ("code" in args) return appApiFail(id, args.code, args.message);
          for (const permission of args.names ?? [...latest.current.declared]) {
            if (stateOf(permission) !== "prompt") continue;
            if (queue.current.length >= MAX_WAITING_REQUESTS) return appApiFail(id, "EPERM", "too many pending requests");
            await new Promise<void>((done) => {
              queue.current.push({ permission, done });
              pumpRef.current();
            });
          }
          return appApiOk(id, stateMap());
        }
        case "permissions.manage": {
          const activation = (navigator as { userActivation?: { isActive?: boolean } }).userActivation;
          if (activation?.isActive !== true) return appApiFail(id, "EPERM", "permissions.manage() needs a click or key press in the app first.");
          if (document.visibilityState !== "visible") return appApiFail(id, "ENOTSUP", "The Permissions dialog can't open while the app's window is hidden.");
          setPanelOpen(true);
          return appApiOk(id, undefined);
        }
        case "notification.show": {
          const args = parseShowArgs(req.args);
          if ("code" in args) return appApiFail(id, args.code, args.message);
          const state = stateOf("notifications");
          if (state === "unavailable") {
            return appApiFail(id, "EPERM", '"notifications" is not in this app\'s openlen-app-manifest, or is unavailable here.');
          }
          if (state !== "granted") return appApiFail(id, "EPERM", 'The person has not allowed "notifications".');
          const now = Date.now();
          if (now - lastShown.current < SHOW_INTERVAL_MS) return appApiFail(id, "EPERM", "too many notifications: at most one a second");
          const c = ctor()!;
          const cur = latest.current;
          try {
            const n = new c(cur.appName, { body: args.body, icon: cur.iconUrl, tag: cur.installationId });
            n.onclick = () => window.focus();
          } catch {
            return appApiFail(id, "ENOTSUP", "This browser can't show notifications here.");
          }
          lastShown.current = now;
          return appApiOk(id, undefined);
        }
      }
    },
    [ctor, stateMap, stateOf],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const cur = latest.current;
      const frameWindow = cur.frame.current?.contentWindow;
      if (!frameWindow || e.source !== frameWindow || !cur.frameOrigin || e.origin !== cur.frameOrigin) return;
      if (!isAppApiRequest(e.data)) return;
      // Copied off the message: nothing the frame passed is read again after the checks.
      const req: AppApiRequest = { channel: e.data.channel, id: e.data.id, method: e.data.method, args: e.data.args };
      const origin = e.origin;
      void handle(req).then((resp) => {
        try {
          frameWindow.postMessage(resp, origin);
        } catch {
          // the frame is gone
        }
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handle]);

  const openPermissions = useCallback(() => setPanelOpen(true), []);
  const closePermissions = useCallback(() => setPanelOpen(false), []);

  const declaredRows = [...new Set(i.declared)].map((permission) => ({ permission, state: stateOf(permission) }));
  const dialog = createElement(
    Fragment,
    null,
    panelOpen
      ? createElement(PermissionsPanel, {
          appName: i.appName,
          notificationsOn: i.notificationsOn,
          rows: declaredRows,
          supported: ctor() !== undefined,
          browserBlocked: browser() === "denied",
          onToggle: toggle,
          onClose: closePermissions,
        })
      : null,
    asking ? createElement(PermissionDialog, { appName: i.appName, reask: asking.reask, onAllow: allow, onDeny: deny }) : null,
  );
  return { dialog, openPermissions };
}
