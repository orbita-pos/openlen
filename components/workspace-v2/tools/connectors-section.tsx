"use client";

// «CONECTORES» ON THE HERRAMIENTAS PAGE (spec local 2026-11-06-conectores-mcp, §5.7): DeepSeek's Settings → MCP for one
// person — each server with its status, «Probar», edit, switch off, delete, add — and the person's keys, by name only.
// A server Len added waits with the same «Conectar» card the chat shows. A key typed here is sent once and never shown.
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import type { McpApprovalCard } from "@/lib/mcp-connectors/approval-card";

import { McpApprovalCardView } from "../chat/mcp-approval-card";

interface ServerRow {
  name: string;
  host: string;
  url: string;
  enabled: boolean;
  approved: boolean;
  status: "connected" | "pending" | "waiting-credentials" | "failed" | "never-listed";
  tools: number;
  headers: string[];
  error?: string;
  approval?: McpApprovalCard;
}
interface View {
  available: boolean;
  version: number;
  servers: ServerRow[];
  credentials: { name: string; updatedAt: string }[];
}
interface HeaderRow {
  name: string;
  value: string;
  secret: boolean;
}
type Probe = { ok: true; tools: string[] } | { ok: false; error: string };

const EMPTY_ROW: HeaderRow = { name: "", value: "", secret: false };
const send = async (url: string, method: string, body?: unknown) => {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

export function ConnectorsSection() {
  const t = useTranslations("wsChrome");
  const [view, setView] = useState<View | null>(null);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [form, setForm] = useState<{ mode: "add" | "edit"; name: string; url: string; rows: HeaderRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyEdit, setKeyEdit] = useState<{ name: string; value: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const { body } = await send("/api/mcp-connectors", "GET");
      setView(body as unknown as View);
    } catch {
      setView(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!view?.available) return null;

  const statusText = (s: ServerRow) =>
    s.status === "connected"
      ? t("tools.connectors.status.connected", { tools: s.tools })
      : s.status === "pending"
        ? t("tools.connectors.status.pending")
        : s.status === "waiting-credentials"
          ? t("tools.connectors.status.waiting", { names: (s.error ?? "").replace(/^missing: /, "") })
          : s.status === "failed"
            ? t("tools.connectors.status.failed", { error: s.error ?? "" })
            : t("tools.connectors.status.neverListed");

  async function probe(name: string) {
    const { body } = await send(`/api/mcp-connectors/${encodeURIComponent(name)}/probe`, "POST");
    setProbes((p) => ({ ...p, [name]: body.ok ? { ok: true, tools: (body.tools as string[]) ?? [] } : { ok: false, error: String(body.error ?? "") } }));
  }

  async function save() {
    if (!form || !view) return;
    const rows = form.rows.filter((r) => r.name.trim() !== "");
    const headers = Object.fromEntries(rows.filter((r) => !r.secret).map((r) => [r.name.trim(), r.value]));
    const secretHeaders = Object.fromEntries(rows.filter((r) => r.secret).map((r) => [r.name.trim(), r.value]));
    // Editing adds headers over the stored ones (the page never had their values, so it can't send them back).
    const payload =
      form.mode === "add" || rows.length > 0
        ? { url: form.url, headers, ...(Object.keys(secretHeaders).length > 0 ? { secretHeaders } : {}), ...(form.mode === "edit" ? { mergeHeaders: true } : {}), version: view.version }
        : { url: form.url, version: view.version };
    const { res, body } = await send(`/api/mcp-connectors/${encodeURIComponent(form.name.trim())}`, "PUT", payload);
    if (!res.ok) return setError(String(body.error ?? res.status));
    setForm(null);
    setError(null);
    await load();
  }

  async function toggle(s: ServerRow) {
    if (!view) return;
    await send(`/api/mcp-connectors/${encodeURIComponent(s.name)}`, "PUT", { url: s.url, enabled: !s.enabled, version: view.version });
    await load();
  }

  async function remove(s: ServerRow) {
    if (!view) return;
    await send(`/api/mcp-connectors/${encodeURIComponent(s.name)}?version=${view.version}`, "DELETE");
    await load();
  }

  async function saveKey() {
    if (!keyEdit) return;
    await send(`/api/mcp-connectors/credentials/${encodeURIComponent(keyEdit.name)}`, "PUT", { value: keyEdit.value });
    setKeyEdit(null);
    await load();
  }

  return (
    <div className="mt-8" data-connectors="">
      <h3 className="text-[15px] font-semibold fg">{t("tools.connectors.title")}</h3>
      <p className="mt-0.5 text-[12px] fg-muted">{t("tools.connectors.hint")}</p>
      <ul className="mt-3 space-y-2">
        {view.servers.map((s) => (
          <li key={s.name} className="rounded-lg border bd bg-elev px-4 py-3" data-connector={s.name}>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold fg">{s.name}</p>
                <p className="text-[12px] fg-muted">
                  {s.host} · {statusText(s)}
                </p>
              </div>
              {s.approved ? (
                <>
                  <button type="button" className="text-[12px] fg" onClick={() => void probe(s.name)}>
                    {t("tools.connectors.probe")}
                  </button>
                  <button type="button" className="text-[12px] fg" onClick={() => setForm({ mode: "edit", name: s.name, url: s.url, rows: [] })}>
                    {t("tools.connectors.edit")}
                  </button>
                  <button type="button" role="switch" aria-checked={s.enabled} className="text-[12px] fg" onClick={() => void toggle(s)}>
                    {s.enabled ? t("tools.connectors.on") : t("tools.connectors.off")}
                  </button>
                </>
              ) : null}
              <button type="button" className="text-[12px] text-red-600" onClick={() => void remove(s)}>
                {t("tools.connectors.remove")}
              </button>
            </div>
            {probes[s.name] ? (
              <p className="mt-1 text-[12px] fg-muted">
                {probes[s.name]!.ok
                  ? t("tools.connectors.probeOk", { tools: (probes[s.name] as { tools: string[] }).tools.join(", ") })
                  : t("tools.connectors.probeFailed", { error: (probes[s.name] as { error: string }).error })}
              </p>
            ) : null}
            {s.approval ? <McpApprovalCardView card={s.approval} /> : null}
          </li>
        ))}
      </ul>
      {form ? (
        <div className="mt-3 rounded-lg border bd bg-elev px-4 py-3" data-connector-form="">
          <label className="block text-[12px] fg-muted">
            {t("tools.connectors.name")}
            <input className="mt-1 block w-full rounded-md border bd bg-app px-2 py-1 fg" value={form.name} disabled={form.mode === "edit"} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="mt-2 block text-[12px] fg-muted">
            {t("tools.connectors.url")}
            <input className="mt-1 block w-full rounded-md border bd bg-app px-2 py-1 fg" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </label>
          <p className="mt-2 text-[12px] fg-muted">{t("tools.connectors.headers")}</p>
          {(form.rows.length > 0 ? form.rows : [EMPTY_ROW]).map((r, i) => {
            const set = (patch: Partial<HeaderRow>) => {
              const rows = form.rows.length > 0 ? [...form.rows] : [{ ...EMPTY_ROW }];
              rows[i] = { ...rows[i]!, ...patch };
              setForm({ ...form, rows });
            };
            return (
              <div key={i} className="mt-1 flex items-center gap-2">
                <input className="w-40 rounded-md border bd bg-app px-2 py-1 text-[12px] fg" value={r.name} onChange={(e) => set({ name: e.target.value })} />
                <input
                  type={r.secret ? "password" : "text"}
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-md border bd bg-app px-2 py-1 text-[12px] fg"
                  value={r.value}
                  onChange={(e) => set({ value: e.target.value })}
                />
                <label className="flex items-center gap-1 text-[12px] fg-muted">
                  <input type="checkbox" checked={r.secret} onChange={(e) => set({ secret: e.target.checked })} />
                  {t("tools.connectors.isKey")}
                </label>
              </div>
            );
          })}
          <button type="button" className="mt-1 text-[12px] fg-muted" onClick={() => setForm({ ...form, rows: [...(form.rows.length > 0 ? form.rows : [EMPTY_ROW]), { ...EMPTY_ROW }] })}>
            {t("tools.connectors.addHeader")}
          </button>
          {error ? <p className="mt-1 text-[12px] text-red-600">{error}</p> : null}
          <div className="mt-2 flex gap-2">
            <button type="button" className="rounded-md bg-[var(--accent)] px-3 py-1 text-[13px] font-medium text-white" onClick={() => void save()}>
              {t("tools.connectors.save")}
            </button>
            <button type="button" className="rounded-md border bd px-3 py-1 text-[13px] fg" onClick={() => setForm(null)}>
              {t("tools.connectors.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="mt-3 rounded-md border bd px-3 py-1.5 text-[13px] fg" onClick={() => setForm({ mode: "add", name: "", url: "", rows: [] })}>
          {t("tools.connectors.add")}
        </button>
      )}
      {view.credentials.length > 0 ? (
        <div className="mt-5">
          <p className="text-[13px] font-semibold fg">{t("tools.connectors.keys")}</p>
          <ul className="mt-1 space-y-1">
            {view.credentials.map((c) => (
              <li key={c.name} className="flex items-center gap-3 text-[12px]">
                <span className="font-mono fg">{c.name}</span>
                <span className="fg-muted">{t("tools.connectors.keySet", { date: c.updatedAt.slice(0, 10) })}</span>
                {keyEdit?.name === c.name ? (
                  <>
                    <input type="password" autoComplete="off" className="rounded-md border bd bg-app px-2 py-0.5 fg" value={keyEdit.value} onChange={(e) => setKeyEdit({ name: c.name, value: e.target.value })} />
                    <button type="button" className="fg" onClick={() => void saveKey()}>
                      {t("tools.connectors.save")}
                    </button>
                  </>
                ) : (
                  <button type="button" className="fg" onClick={() => setKeyEdit({ name: c.name, value: "" })}>
                    {t("tools.connectors.changeKey")}
                  </button>
                )}
                <button
                  type="button"
                  className="text-red-600"
                  onClick={() => void send(`/api/mcp-connectors/credentials/${encodeURIComponent(c.name)}`, "DELETE").then(() => load())}
                >
                  {t("tools.connectors.remove")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
