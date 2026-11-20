"use client";

// THE «CONECTAR» CARD (spec local 2026-11-06-conectores-mcp, §5.3): drawn by OpenLen under Len's answer when he added or
// changed a server in ~/.len/mcp.json. Nothing connects until the person taps «Conectar»; the tap approves the entry as
// the card shows it (its fingerprint and the file's version). It names every key the server would receive and, in red,
// any other host that already gets that key. Keys typed here go to OpenLen's store and are never shown again.
//
// An OAuth sign-in (spec local 2026-11-17-oauth-de-conectores-mcp, §10.2, §10.5) is the same tap: the card names the host
// each key goes to (the authorization server's for a client secret, not the MCP server's) and where the person signs in
// (the server's own page when nobody knows its host), remembers that the approval went through so a retry never sends
// the stale version again, and leaves «Try again» after a failure, in words. Every remote string is drawn as text.
//
// The start checks the sign-in host this card named (final review F3, spec §10.2): when the server signs in elsewhere
// now, the card names the new host and says the page changed, and the next tap is checked against that one.
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { McpApprovalCard } from "@/lib/mcp-connectors/approval-card";

import { openSignIn, postStart, SignInError } from "./open-sign-in";
import { showsDetail, signInErrorKey } from "./sign-in-errors";

type State =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected"; tools: number }
  | { kind: "oauth-connected" }
  | { kind: "failed"; error: string }
  | { kind: "sign-in-failed"; code: string; detail?: string }
  | { kind: "changed" }
  | { kind: "dismissed" }
  | { kind: "error"; text: string };

export function McpApprovalCardView({ card }: { card: McpApprovalCard }) {
  const t = useTranslations("panelsChat");
  const [state, setState] = useState<State>({ kind: "idle" });
  // The approval went through (the file's version moved on with it): a retry goes straight to the sign-in, and the keys
  // typed here were sent with it.
  const [approved, setApproved] = useState(false);
  const missing = approved ? [] : card.credentials.filter((c) => !c.set);
  const [values, setValues] = useState<Record<string, string>>({});
  // Where the person signs in, as this card names it now: the start may have found it moved (issuer_changed).
  const [oauth, setOauth] = useState(card.oauth);

  // Where the sign-in is. The server's own page when nobody knows its host: never the MCP server's, which is where the
  // tools are and not where the person signs in.
  function signInLine(oauth: NonNullable<McpApprovalCard["oauth"]>): string {
    const issuer = oauth.issuerHost;
    if (issuer === null) {
      return oauth.reason === "lapsed"
        ? t("mcpApproval.signInAgainOnServerPage")
        : oauth.reason === "scope"
          ? t("mcpApproval.morePermissionsOnServerPage")
          : t("mcpApproval.signInOnServerPage");
    }
    return oauth.reason === "lapsed"
      ? t("mcpApproval.signInAgainAt", { issuer })
      : oauth.reason === "scope"
        ? t("mcpApproval.morePermissionsAt", { issuer })
        : t("mcpApproval.signInAt", { issuer });
  }

  async function connect() {
    const credentials = Object.fromEntries(missing.map((c) => [c.name, values[c.name] ?? ""]).filter(([, v]) => v));
    if (card.suggest || oauth) {
      let sawChanged = false;
      // Open the popup synchronously on the click before any state update or await.
      const signIn = openSignIn(card.server, {
        // The host this card named is what the start checks (the directory's route checks its own).
        ...(!card.suggest && oauth ? { issuerHost: oauth.issuerHost } : {}),
        ...(card.suggest
          ? { start: () => postStart(`/api/mcp-connectors/directory/${encodeURIComponent(card.suggest!.id)}`) }
          : card.version > 0 && !approved
            ? {
                approve: async () => {
                  const res = await fetch(`/api/mcp-connectors/${encodeURIComponent(card.server)}/approve`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ fingerprint: card.fingerprint, version: card.version, credentials }),
                  });
                  const body = (await res.json().catch(() => ({}))) as { error?: string };
                  if (res.status === 409) {
                    sawChanged = true;
                    setState({ kind: "changed" });
                    return false;
                  }
                  if (!res.ok) throw new SignInError(body.error ?? String(res.status));
                  setValues({});
                  setApproved(true);
                  return true;
                },
              }
            : {}),
      });
      setState({ kind: "connecting" });
      const res = await signIn;
      if (res === "connected") return setState({ kind: "oauth-connected" });
      if (res === "closed") {
        if (!sawChanged) setState({ kind: "idle" });
        return;
      }
      // The entry was edited while the person was signing in: it needs another look, not another try.
      if (res.error === "changed") return setState({ kind: "changed" });
      // The sign-in page moved: the card names where it is now, so the person sees it before tapping again.
      if (res.error === "issuer_changed" && res.issuerHost !== undefined && oauth && !card.suggest) setOauth({ ...oauth, issuerHost: res.issuerHost });
      return setState({ kind: "sign-in-failed", code: res.error, ...(res.detail ? { detail: res.detail } : {}) });
    }
    setState({ kind: "connecting" });
    try {
      const res = await fetch(`/api/mcp-connectors/${encodeURIComponent(card.server)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint: card.fingerprint, version: card.version, credentials }),
      });
      const body = (await res.json().catch(() => ({}))) as { state?: { status?: string; tools?: number; error?: string | null } | null; error?: string };
      if (res.status === 409) return setState({ kind: "changed" });
      if (!res.ok) return setState({ kind: "error", text: body.error ?? String(res.status) });
      setValues({});
      if (body.state?.status === "connected") return setState({ kind: "connected", tools: body.state.tools ?? 0 });
      setState({ kind: "failed", error: body.state?.error ?? body.state?.status ?? "" });
    } catch (err) {
      setState({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="mt-2 rounded-lg border bd bg-elev px-3 py-2.5 text-[13px]" data-mcp-approval={card.server}>
      <p className="font-semibold fg">
        {card.suggest ? t("mcpApproval.suggestTitle", { name: card.suggest.name, host: card.suggest.host }) : t("mcpApproval.title", { server: card.server, host: card.host })}
      </p>
      {oauth ? (
        <p className="mt-1 fg-muted" data-mcp-sign-in="">
          {signInLine(oauth)}
        </p>
      ) : null}
      {card.credentials.map((c) => (
        <div key={c.name} className="mt-1">
          <p className="fg-muted" data-mcp-sends="">
            {c.destinationHosts.length > 0
              ? t("mcpApproval.sends", { name: c.name, host: c.destinationHosts.join(", ") })
              : oauth
                ? t("mcpApproval.sendsToSignIn", { name: c.name })
                : t("mcpApproval.sends", { name: c.name, host: card.host })}
          </p>
          {c.otherHosts.length > 0 ? (
            <p className="text-[12px] text-red-600" data-mcp-key-warning="">
              {t("mcpApproval.usedElsewhere", { name: c.name, hosts: c.otherHosts.join(", ") })}
            </p>
          ) : c.firstTime ? (
            <p className="text-[12px] text-red-600" data-mcp-key-warning="">
              {t("mcpApproval.firstTime", { name: c.name, host: c.destinationHosts.join(", ") || card.host })}
            </p>
          ) : null}
        </div>
      ))}
      {state.kind === "idle" || state.kind === "connecting" || state.kind === "error" || state.kind === "sign-in-failed" ? (
        <>
          {missing.map((c) => (
            <label key={c.name} className="mt-2 block text-[12px] fg-muted">
              {t("mcpApproval.paste", { name: c.name })}
              <input
                type="password"
                autoComplete="off"
                className="mt-1 block w-full rounded-md border bd bg-app px-2 py-1 fg"
                value={values[c.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))}
              />
            </label>
          ))}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={state.kind === "connecting"}
              onClick={() => void connect()}
              className="rounded-md bg-[var(--accent)] px-3 py-1 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {state.kind === "sign-in-failed" ? t("mcpApproval.tryAgain") : t("mcpApproval.connect")}
            </button>
            <button type="button" onClick={() => setState({ kind: "dismissed" })} className="rounded-md border bd px-3 py-1 text-[13px] fg">
              {t("mcpApproval.no")}
            </button>
          </div>
          {state.kind === "error" ? <p className="mt-1 text-[12px] text-red-600">{state.text}</p> : null}
          {state.kind === "sign-in-failed" ? (
            <div className="mt-1 text-[12px] text-red-600" role="alert" data-mcp-sign-in-error="">
              <p>{t(`mcpApproval.errors.${signInErrorKey(state.code)}`)}</p>
              {state.detail && showsDetail(state.code) ? <p className="fg-muted">{state.detail}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
      {state.kind === "connected" ? <p className="mt-1 fg">{t("mcpApproval.connected", { tools: state.tools })}</p> : null}
      {state.kind === "oauth-connected" ? <p className="mt-1 fg">{t("mcpApproval.oauthConnected")}</p> : null}
      {state.kind === "failed" ? <p className="mt-1 text-red-600">{t("mcpApproval.failed", { error: state.error })}</p> : null}
      {state.kind === "failed" || state.kind === "sign-in-failed" ? (
        // The person can look at it where it lives, without losing this chat (a new tab).
        <a className="mt-1 block text-[12px] fg-muted underline" href="/new?view=tools" target="_blank" rel="noopener noreferrer" data-mcp-open-connectors="">
          {t("mcpApproval.openConnectors")}
        </a>
      ) : null}
      {state.kind === "changed" ? <p className="mt-1 fg-muted">{t("mcpApproval.changed")}</p> : null}
      {state.kind === "dismissed" ? <p className="mt-1 fg-muted">{t("mcpApproval.dismissed")}</p> : null}
    </div>
  );
}
