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
// If the window closes with no word, the server's own state decides: the way back may have been cut after the connection
// was made, so the connectors are read again and «connected» is what they say.
import { SIGN_IN_CHANNEL } from "@/lib/mcp-connectors/oauth/sign-in-channel";

/** A sign-in that couldn't start: the server's code, and what it said about it (never shown as a code). */
export class SignInError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "SignInError";
  }
}

export type SignInResult = "connected" | "closed" | { error: string; detail?: string };

/** What a start answers: where to send the window, and the name the server ended up with (the directory may pick
 *  `google-calendar-2` when the first name was taken). */
export interface StartedSignIn {
  authorizationUrl: string;
  server?: string;
}

export interface OpenSignInOptions {
  approve?: () => Promise<boolean>;
  start?: (server: string) => Promise<string | StartedSignIn>;
}

/** POST to a route that starts a sign-in (`…/<name>/oauth`, `…/directory/<id>`), as `{ authorizationUrl, server? }`. */
export async function postStart(url: string): Promise<StartedSignIn> {
  const res = await fetch(url, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { authorizationUrl?: unknown; server?: unknown; detail?: unknown; error?: unknown };
  if (!res.ok || typeof body.authorizationUrl !== "string") {
    throw new SignInError(typeof body.error === "string" && body.error ? body.error : String(res.status), typeof body.detail === "string" ? body.detail : undefined);
  }
  return { authorizationUrl: body.authorizationUrl, ...(typeof body.server === "string" && body.server ? { server: body.server } : {}) };
}

const defaultStart = (server: string) => postStart(`/api/mcp-connectors/${encodeURIComponent(server)}/oauth`);

function errorOf(err: unknown): { error: string; detail?: string } {
  if (err instanceof SignInError) return { error: err.code, ...(err.detail ? { detail: err.detail } : {}) };
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
  return { error: typeof m.reason === "string" && /^[a-z_]{1,40}$/.test(m.reason) ? m.reason : "failed" };
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
      let asking = false;
      timer = setInterval(() => {
        if (!popup.closed || asking) return;
        asking = true;
        void connectedNow(expected).then((connected) => finish(connected ? "connected" : "closed"));
      }, 200);
    });
  })();
}
