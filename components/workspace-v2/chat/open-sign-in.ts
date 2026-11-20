// ONE-TAP OAUTH SIGN-IN FOR A CONNECTOR (spec local 2026-11-17-oauth-de-conectores-mcp, §10.5): opens the popup window
// synchronously on the person's click (before any `await`, so the browser never blocks it), approves the entry if
// approval is pending, asks OpenLen for the authorization URL, navigates the popup there, and waits for the way back.
//
// Three things about the window itself:
//  - It is cut off from this tab (`opener = null`) BEFORE it goes anywhere: the provider's pages must not hold a handle
//    on the workspace (reverse tabnabbing). It is still same-origin `about:blank` at that moment, so it can be done.
//  - The address it is sent to is the one OpenLen's server answered with, and it must be `https:` or nothing: a
//    redirect to `javascript:` or `http:` is refused here too, not only on the server.
//  - It may come back with no opener (that cut, or the provider's Cross-Origin-Opener-Policy), so the callback page
//    tells this tab twice: on a same-origin `BroadcastChannel` and, as a fallback, with `postMessage` to the opener. Both
//    are read the same way — the page's origin, the message type, and the server this sign-in is for.
// The window's own `closed` says nothing reliable: a provider's Cross-Origin-Opener-Policy makes it read `true` right
// after the window leaves for the provider, while the person is still signing in (final review M2). So this keeps
// listening for the way back for as long as a sign-in lives (ten minutes, store.ts `FLOW_TTL_MS`), and asks OpenLen every
// five seconds whether the server is connected — the way back may have been cut after the connection was made. «Closed»
// is what is left when the ten minutes are up with no word and no connection.
//
// The start is told the sign-in host the card named (`issuerHost`, final review F3, spec §10.2): when the server now signs
// in elsewhere it answers `issuer_changed` with the new host, and the card shows it before the person taps again.
import { SIGN_IN_CHANNEL } from "@/lib/mcp-connectors/oauth/sign-in-channel";

import { signInHostFrom as hostIn } from "./sign-in-errors";

/** A sign-in that couldn't start: the server's code, what it said about it (never shown as a code) and, for
 *  `issuer_changed`, the sign-in host now (null: the server's own page). */
export class SignInError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
    readonly issuerHost?: string | null,
  ) {
    super(code);
    this.name = "SignInError";
  }
}

export type SignInResult = "connected" | "closed" | { error: string; detail?: string; issuerHost?: string | null };

/** What a start answers: where to send the window, and the name the server ended up with (the directory may pick
 *  `google-calendar-2` when the first name was taken). */
export interface StartedSignIn {
  authorizationUrl: string;
  server?: string;
}

export interface OpenSignInOptions {
  approve?: () => Promise<boolean>;
  start?: (server: string) => Promise<string | StartedSignIn>;
  /** The sign-in host the card named (null: the server's own page), sent to the default start, which checks it. Absent:
   *  no card (the Herramientas page) — the server checks the host its stored state names. */
  issuerHost?: string | null;
}

/** How long a sign-in can come back: the life of its `state` (store.ts `FLOW_TTL_MS`). */
export const SIGN_IN_WAIT_MS = 10 * 60 * 1000;
/** How often OpenLen is asked whether the server is connected while the way back hasn't spoken. */
export const SIGN_IN_ASK_EVERY_MS = 5_000;

/** POST to a route that starts a sign-in (`…/<name>/oauth`, `…/directory/<id>`), as `{ authorizationUrl, server? }`. */
export async function postStart(url: string, body?: Record<string, unknown>): Promise<StartedSignIn> {
  const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });
  const answer = (await res.json().catch(() => ({}))) as { authorizationUrl?: unknown; server?: unknown; detail?: unknown; error?: unknown; issuerHost?: unknown };
  if (!res.ok || typeof answer.authorizationUrl !== "string") {
    throw new SignInError(
      typeof answer.error === "string" && answer.error ? answer.error : String(res.status),
      typeof answer.detail === "string" ? answer.detail : undefined,
      hostIn(answer.issuerHost),
    );
  }
  return { authorizationUrl: answer.authorizationUrl, ...(typeof answer.server === "string" && answer.server ? { server: answer.server } : {}) };
}

function errorOf(err: unknown): { error: string; detail?: string; issuerHost?: string | null } {
  if (err instanceof SignInError) return { error: err.code, ...(err.detail ? { detail: err.detail } : {}), ...(err.issuerHost !== undefined ? { issuerHost: err.issuerHost } : {}) };
  return { error: err instanceof Error ? err.message : String(err) };
}

function isHttps(raw: string): boolean {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

/** What a message from the callback page says, for the sign-in of `expected`; null when it isn't for this one. */
function readMessage(data: unknown, expected: string): SignInResult | null {
  if (!data || typeof data !== "object") return null;
  const m = data as { type?: unknown; server?: unknown; ok?: unknown; reason?: unknown };
  if (m.type !== SIGN_IN_CHANNEL) return null;
  if (m.server !== undefined && m.server !== null && m.server !== expected) return null;
  // A success is for a server: one that doesn't say which isn't this sign-in's.
  if (m.ok === true) return m.server === expected ? "connected" : null;
  if (m.reason === "denied") return "closed";
  const error = typeof m.reason === "string" && /^[a-z_]{1,40}$/.test(m.reason) ? m.reason : "failed";
  // Where the sign-in is now, when the way back found it moved: a hostname, or nothing.
  const issuerHost = error === "issuer_changed" ? hostIn((m as { issuerHost?: unknown }).issuerHost) : undefined;
  return issuerHost !== undefined ? { error, issuerHost } : { error };
}

/** Is `server` connected now, by OpenLen's own account? Any doubt is «no». */
async function connectedNow(server: string): Promise<boolean> {
  try {
    const res = await fetch("/api/mcp-connectors");
    if (!res.ok) return false;
    const body = (await res.json()) as { servers?: { name?: unknown; status?: unknown }[] };
    return Array.isArray(body.servers) && body.servers.some((s) => s?.name === server && s.status === "connected");
  } catch {
    return false;
  }
}

export function openSignIn(server: string, opts: OpenSignInOptions = {}): Promise<SignInResult> {
  const popup = typeof window !== "undefined" ? window.open("about:blank", "openlen-mcp-oauth", "popup,width=520,height=680") : null;
  if (!popup) return Promise.resolve({ error: "popup_blocked" });
  // Still our own blank page: from here on, whatever it navigates to has no way back to this tab.
  try {
    popup.opener = null;
  } catch {}
  const closePopup = () => {
    try {
      popup.close();
    } catch {}
  };

  return (async () => {
    if (opts.approve) {
      let approved = false;
      try {
        approved = await opts.approve();
      } catch (err) {
        closePopup();
        return errorOf(err);
      }
      if (!approved) {
        closePopup();
        return "closed";
      }
    }

    const defaultStart = (name: string) =>
      postStart(`/api/mcp-connectors/${encodeURIComponent(name)}/oauth`, opts.issuerHost !== undefined ? { issuerHost: opts.issuerHost } : undefined);
    let started: StartedSignIn;
    try {
      const answer = await (opts.start ?? defaultStart)(server);
      started = typeof answer === "string" ? { authorizationUrl: answer } : answer;
    } catch (err) {
      closePopup();
      return errorOf(err);
    }
    if (!isHttps(started.authorizationUrl)) {
      closePopup();
      return { error: "sign_in_url_refused" };
    }
    // The name the server ended up with is the one the way back will carry.
    const expected = started.server ?? server;

    popup.location.href = started.authorizationUrl;

    return await new Promise<SignInResult>((resolve) => {
      let done = false;
      let channel: BroadcastChannel | null = null;
      let timer: ReturnType<typeof setInterval> | undefined;
      const finish = (result: SignInResult) => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onMessage);
        try {
          channel?.close();
        } catch {}
        clearInterval(timer);
        resolve(result);
      };
      const heard = (data: unknown) => {
        const result = readMessage(data, expected);
        if (result === null) return;
        closePopup();
        finish(result);
      };
      const onMessage = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return;
        heard(e.data);
      };
      window.addEventListener("message", onMessage);
      try {
        // Same-origin by construction: only OpenLen's own pages can post here.
        if (typeof BroadcastChannel !== "undefined") {
          channel = new BroadcastChannel(SIGN_IN_CHANNEL);
          channel.addEventListener("message", (e: MessageEvent) => heard(e.data));
        }
      } catch {
        channel = null;
      }
      const since = Date.now();
      let asked = since;
      let asking = false;
      timer = setInterval(() => {
        if (asking) return;
        const now = Date.now();
        const over = now - since >= SIGN_IN_WAIT_MS;
        if (!over && now - asked < SIGN_IN_ASK_EVERY_MS) return;
        asked = now;
        asking = true;
        void connectedNow(expected).then((connected) => {
          asking = false;
          if (!connected && !over) return;
          // Connected without a word from the way back, or out of time: the window has nothing left to do.
          closePopup();
          finish(connected ? "connected" : "closed");
        });
      }, 1_000);
    });
  })();
}
