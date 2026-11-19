// ONE-TAP OAUTH SIGN-IN FOR A CONNECTOR (spec local 2026-11-17-oauth-de-conectores-mcp, §10.5): opens the popup window
// synchronously on the person's click (before any `await`, so the browser never blocks it), approves the entry if
// approval is pending, asks OpenLen for the authorization URL, navigates the popup there, and waits for the callback's
// `postMessage` from OpenLen's origin (or the popup closing). If `approve` or `start` fails, the popup is closed at once.

export interface OpenSignInOptions {
  approve?: () => Promise<boolean>;
  start?: (server: string) => Promise<string>;
}

async function defaultStart(server: string): Promise<string> {
  const res = await fetch(`/api/mcp-connectors/${encodeURIComponent(server)}/oauth`, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { authorizationUrl?: string; detail?: string; error?: string };
  if (!res.ok || typeof body.authorizationUrl !== "string") {
    throw new Error(body.detail ?? body.error ?? String(res.status));
  }
  return body.authorizationUrl;
}

export function openSignIn(
  server: string,
  opts: OpenSignInOptions = {},
): Promise<"connected" | "closed" | { error: string }> {
  const popup = typeof window !== "undefined" ? window.open("about:blank", "openlen-mcp-oauth", "popup,width=520,height=680") : null;
  if (!popup) return Promise.resolve({ error: "popup_blocked" });

  return (async () => {
    if (opts.approve) {
      let approved = false;
      try {
        approved = await opts.approve();
      } catch (err) {
        try {
          popup.close();
        } catch {}
        return { error: err instanceof Error ? err.message : String(err) };
      }
      if (!approved) {
        try {
          popup.close();
        } catch {}
        return "closed";
      }
    }

    const startFn = opts.start ?? defaultStart;
    let url: string;
    try {
      url = await startFn(server);
    } catch (err) {
      try {
        popup.close();
      } catch {}
      return { error: err instanceof Error ? err.message : String(err) };
    }

    popup.location.href = url;

    return await new Promise<"connected" | "closed" | { error: string }>((resolve) => {
      const finish = (result: "connected" | "closed" | { error: string }) => {
        window.removeEventListener("message", onMessage);
        clearInterval(timer);
        resolve(result);
      };
      const onMessage = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return;
        const data = e.data as { type?: unknown; server?: unknown; ok?: unknown; reason?: unknown } | null;
        if (!data || data.type !== "openlen:mcp-oauth") return;
        if (data.server && data.server !== server) return;
        try {
          popup.close();
        } catch {}
        if (data.ok === true) return finish("connected");
        if (data.reason === "denied") return finish("closed");
        return finish({ error: typeof data.reason === "string" ? data.reason : "failed" });
      };
      window.addEventListener("message", onMessage);
      const timer = setInterval(() => {
        if (popup.closed) finish("closed");
      }, 200);
    });
  })();
}
