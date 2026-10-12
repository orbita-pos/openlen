"use client";
// «APLICACIONES CONECTADAS»: cada conexión con lo que puede, su último uso, su
// actividad y «Revocar»; y crear un token personal, cuyo secreto se enseña UNA
// vez. Habla con /api/mcp/connections y /api/mcp/tokens con la cookie de la web.
import { useState } from "react";
import { useTranslations } from "next-intl";

export interface ConnectionItem {
  id: string;
  kind: "oauth" | "personal";
  name: string;
  verified: boolean;
  clientHost: string | null;
  scopes: string[];
  projectTitle: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

interface ActivityItem {
  tool: string;
  ok: boolean;
  errorCode: string | null;
  createdAt: string;
}

const EXPIRY = [30, 90, 365, null] as const;
type Expiry = (typeof EXPIRY)[number];
const DAY_MS = 86_400_000;

export function ConnectionsView({
  initial,
  nextCursor: firstCursor,
  projects,
  mcpUrl,
  locale,
}: {
  initial: ConnectionItem[];
  /** El cursor de la siguiente página (de 20 en 20), o null si no hay más. */
  nextCursor: string | null;
  projects: { id: string; title: string }[];
  mcpUrl: string;
  locale: string;
}) {
  const t = useTranslations("projects.mcpConnections");
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [activity, setActivity] = useState<Record<string, ActivityItem[]>>({});
  const [failed, setFailed] = useState(false);
  const [cursor, setCursor] = useState(firstCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  // Dos conexiones con el mismo nombre (dos «Cursor», dos «CI»): una marca de su id las distingue.
  const counts = new Map<string, number>();
  for (const c of items) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const scopeLabel = (s: string) => (s === "projects:write" ? t("scopeWrite") : s === "publish" ? t("scopePublish") : t("scopeRead"));

  const toggleActivity = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (activity[id]) return;
    const res = await fetch(`/api/mcp/connections/${encodeURIComponent(id)}/activity`).catch(() => null);
    const body = res?.ok ? ((await res.json()) as { activity: ActivityItem[] }) : null;
    setActivity((a) => ({ ...a, [id]: body?.activity ?? [] }));
  };
  const showMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    const res = await fetch(`/api/mcp/connections?cursor=${encodeURIComponent(cursor)}`).catch(() => null);
    setLoadingMore(false);
    const body = res?.ok ? ((await res.json()) as { connections: ConnectionItem[]; next_cursor: string | null }) : null;
    if (!body) return setFailed(true);
    setItems((xs) => [...xs, ...body.connections.filter((n) => !xs.some((x) => x.id === n.id))]);
    setCursor(body.next_cursor);
  };
  const revoke = async (c: ConnectionItem) => {
    if (!window.confirm(t("revokeConfirm", { name: c.name }))) return;
    const res = await fetch(`/api/mcp/connections/${encodeURIComponent(c.id)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setFailed(true);
    setItems((xs) => xs.filter((x) => x.id !== c.id));
    // La lista del servidor tiene una menos: la página siguiente empieza una antes.
    setCursor((cur) => (cur ? String(Math.max(0, Number(cur) - 1)) : cur));
  };

  return (
    <div className="flex flex-col gap-6">
      {failed ? (
        <p role="alert" className="text-sm">
          {t("failed")}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm opacity-70">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((c) => (
            <li key={c.id} className="rounded-lg border px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">
                    {c.name}
                    {(counts.get(c.name) ?? 0) > 1 ? (
                      <span data-connection-tag className="ml-2 font-mono text-xs opacity-60">
                        #{c.id.slice(-4)}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs opacity-70">
                    {c.kind === "personal" ? t("kindPersonal") : t("kindOauth")}
                    {c.kind === "oauth" ? ` · ${c.verified ? t("verified") : t("unverified")}` : ""}
                    {c.clientHost ? ` · ${c.clientHost}` : ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => toggleActivity(c.id)} className="rounded-full border px-3 py-1 text-sm">
                    {t("activity")}
                  </button>
                  <button type="button" onClick={() => revoke(c)} className="rounded-full border px-3 py-1 text-sm">
                    {t("revoke")}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm opacity-80">
                {c.scopes.map(scopeLabel).join(" · ")}
                {" — "}
                {c.projectTitle ? t("onlyProject", { project: c.projectTitle }) : t("allProjects")}
              </p>
              <p className="text-xs opacity-60">
                {c.lastUsedAt ? t("lastUsed", { when: when(c.lastUsedAt) }) : t("neverUsed")}
                {c.expiresAt ? ` · ${t("expires", { when: when(c.expiresAt) })}` : ""}
              </p>
              {open === c.id && activity[c.id] ? (
                <ul className="mt-2 flex flex-col gap-1 text-xs">
                  {activity[c.id]!.length === 0 ? (
                    <li className="opacity-60">{t("activityEmpty")}</li>
                  ) : (
                    activity[c.id]!.map((a, i) => (
                      <li key={i} className="font-mono">
                        {when(a.createdAt)} · {a.tool}
                        {a.ok ? "" : ` · ${t("activityError", { code: a.errorCode ?? "?" })}`}
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <button type="button" disabled={loadingMore} onClick={showMore} className="self-start rounded-full border px-4 py-1.5 text-sm disabled:opacity-50">
          {t("showMore")}
        </button>
      ) : null}
      <NewTokenForm projects={projects} mcpUrl={mcpUrl} onCreated={(c) => setItems((xs) => [c, ...xs])} onFailed={() => setFailed(true)} />
    </div>
  );
}

function NewTokenForm({
  projects,
  mcpUrl,
  onCreated,
  onFailed,
}: {
  projects: { id: string; title: string }[];
  mcpUrl: string;
  onCreated: (c: ConnectionItem) => void;
  onFailed: () => void;
}) {
  const t = useTranslations("projects.mcpConnections");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [expiry, setExpiry] = useState<Expiry>(90);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const toggle = (s: string) => setScopes((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]));
  const expiryLabel = (d: Expiry) => (d === 30 ? t("expiry30") : d === 90 ? t("expiry90") : d === 365 ? t("expiry365") : t("expiryNever"));

  const create = async () => {
    setBusy(true);
    const res = await fetch("/api/mcp/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, scopes, project_id: projectId || null, expires_in_days: expiry }),
    }).catch(() => null);
    setBusy(false);
    const body = res?.ok ? ((await res.json()) as { id: string; token: string }) : null;
    if (!body) return onFailed();
    const now = new Date();
    setSecret(body.token);
    onCreated({
      id: body.id,
      kind: "personal",
      name: name.trim(),
      verified: true,
      clientHost: null,
      scopes: ["projects:read", ...scopes],
      projectTitle: projects.find((p) => p.id === projectId)?.title ?? null,
      createdAt: now.toISOString(),
      lastUsedAt: null,
      expiresAt: expiry === null ? null : new Date(now.getTime() + expiry * DAY_MS).toISOString(),
    });
    setName("");
    setScopes([]);
    setProjectId("");
  };

  if (secret) {
    const line = `claude mcp add --transport http openlen ${mcpUrl} --header "Authorization: Bearer ${secret}"`;
    return (
      <section className="flex flex-col gap-2 rounded-lg border px-4 py-3">
        <h2 className="font-medium">{t("secretTitle")}</h2>
        <p className="text-sm">{t("secretWarning")}</p>
        <code data-secret className="break-all rounded bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
          {secret}
        </code>
        <code className="break-all rounded bg-black/5 px-2 py-1 text-xs dark:bg-white/10">{line}</code>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(secret);
              setCopied(true);
            }}
            className="rounded-full border px-3 py-1 text-sm"
          >
            {copied ? t("copied") : t("copy")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSecret(null);
              setCopied(false);
            }}
            className="rounded-full border px-3 py-1 text-sm"
          >
            {t("done")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border px-4 py-3">
      <h2 className="font-medium">{t("newToken")}</h2>
      <p className="text-sm opacity-70">{t("newTokenHelp")}</p>
      <label className="flex flex-col gap-1 text-sm">
        {t("tokenName")}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("tokenNamePlaceholder")} maxLength={100} className="rounded-lg border bg-transparent px-3 py-2 dark:[color-scheme:dark]" />
      </label>
      <fieldset className="flex flex-col gap-1 text-sm">
        <label className="flex items-center gap-2 opacity-70">
          <input type="checkbox" checked disabled readOnly /> {t("scopeRead")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={scopes.includes("projects:write")} onChange={() => toggle("projects:write")} /> {t("scopeWrite")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={scopes.includes("publish")} onChange={() => toggle("publish")} /> {t("scopePublish")}
        </label>
      </fieldset>
      <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm dark:[color-scheme:dark]">
        <option value="">{t("allProjects")}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {t("onlyProject", { project: p.title })}
          </option>
        ))}
      </select>
      <label className="flex flex-col gap-1 text-sm">
        {t("expiry")}
        <select
          value={String(expiry)}
          onChange={(e) => setExpiry(e.target.value === "null" ? null : (Number(e.target.value) as Exclude<Expiry, null>))}
          className="rounded-lg border bg-transparent px-3 py-2 dark:[color-scheme:dark]"
        >
          {EXPIRY.map((d) => (
            <option key={String(d)} value={String(d)}>
              {expiryLabel(d)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy || !name.trim()}
        onClick={create}
        className="self-start rounded-full bg-black px-5 py-2 font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {t("create")}
      </button>
    </section>
  );
}
