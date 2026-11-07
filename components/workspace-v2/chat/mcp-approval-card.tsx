"use client";

// THE «CONECTAR» CARD (spec local 2026-11-06-conectores-mcp, §5.3): drawn by OpenLen under Len's answer when he added or
// changed a server in ~/.len/mcp.json. Nothing connects until the person taps «Conectar»; the tap approves the entry as
// the card shows it (its fingerprint and the file's version). It names every key the server would receive and, in red,
// any other host that already gets that key. Keys typed here go to OpenLen's store and are never shown again.
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { McpApprovalCard } from "@/lib/mcp-connectors/approval-card";

type State =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected"; tools: number }
  | { kind: "failed"; error: string }
  | { kind: "changed" }
  | { kind: "dismissed" }
  | { kind: "error"; text: string };

export function McpApprovalCardView({ card }: { card: McpApprovalCard }) {
  const t = useTranslations("panelsChat");
  const [state, setState] = useState<State>({ kind: "idle" });
  const missing = card.credentials.filter((c) => !c.set);
  const [values, setValues] = useState<Record<string, string>>({});

  async function connect() {
    setState({ kind: "connecting" });
    try {
      const credentials = Object.fromEntries(missing.map((c) => [c.name, values[c.name] ?? ""]).filter(([, v]) => v));
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
      <p className="font-semibold fg">{t("mcpApproval.title", { server: card.server, host: card.host })}</p>
      {card.credentials.map((c) => (
        <div key={c.name} className="mt-1">
          <p className="fg-muted">{t("mcpApproval.sends", { name: c.name, host: card.host })}</p>
          {c.otherHosts.length > 0 ? (
            <p className="text-[12px] text-red-600" data-mcp-key-warning="">
              {t("mcpApproval.usedElsewhere", { name: c.name, hosts: c.otherHosts.join(", ") })}
            </p>
          ) : null}
        </div>
      ))}
      {state.kind === "idle" || state.kind === "connecting" || state.kind === "error" ? (
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
              {t("mcpApproval.connect")}
            </button>
            <button type="button" onClick={() => setState({ kind: "dismissed" })} className="rounded-md border bd px-3 py-1 text-[13px] fg">
              {t("mcpApproval.no")}
            </button>
          </div>
          {state.kind === "error" ? <p className="mt-1 text-[12px] text-red-600">{state.text}</p> : null}
        </>
      ) : null}
      {state.kind === "connected" ? <p className="mt-1 fg">{t("mcpApproval.connected", { tools: state.tools })}</p> : null}
      {state.kind === "failed" ? <p className="mt-1 text-red-600">{t("mcpApproval.failed", { error: state.error })}</p> : null}
      {state.kind === "changed" ? <p className="mt-1 fg-muted">{t("mcpApproval.changed")}</p> : null}
      {state.kind === "dismissed" ? <p className="mt-1 fg-muted">{t("mcpApproval.dismissed")}</p> : null}
    </div>
  );
}
