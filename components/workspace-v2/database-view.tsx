"use client";
// LA BASE DE DATOS DE LA PÁGINA (fase 6 de plans/pages-backend/design.md).
//
// Lo que el editor de tablas y Authentication → Users de Supabase le enseñan
// al dueño, sobre el backend de su página: ver y cambiar las filas de cada
// tabla —todas, como el editor de Supabase, que salta RLS— y quién se ha dado
// de alta, con invitar, cerrar sesiones y borrar. Las tablas las crea Len con
// sus migraciones: aquí no se diseña el esquema.
//
// Las rutas: app/api/projects/[id]/backend/** (lib/backend/dashboard.ts).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  LogOut,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Table2,
  Trash2,
  Users,
} from "lucide-react";

import type { ColumnInfo, PanelUser, Row, TableInfo } from "@/lib/backend/dashboard";

type Overview =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "unavailable" | "none" }
  | { readonly status: "empty"; readonly url: string }
  | { readonly status: "ready"; readonly url: string; readonly tables: readonly TableInfo[] };

const PAGE_SIZE = 50;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function DatabaseView({ projectId }: { projectId: string | null }) {
  const t = useTranslations("wsChrome.database");
  const [tab, setTab] = useState<"tables" | "users">("tables");
  const [overview, setOverview] = useState<Overview>({ status: "loading" });

  const load = useCallback(async () => {
    if (!projectId) {
      setOverview({ status: "none" });
      return;
    }
    setOverview({ status: "loading" });
    try {
      setOverview(await call<Overview>(`/api/projects/${projectId}/backend`));
    } catch (e) {
      setOverview({ status: "error", message: errorText(e) });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-app text-zinc-900 dark:text-zinc-100">
      <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 px-3 pt-3 sm:px-5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-coral-500/10 text-coral-500">
            <Database size={16} />
          </span>
          <h1 className="text-[15px] font-semibold leading-tight">{t("title")}</h1>
          {"url" in overview && <ProjectUrl url={overview.url} />}
          <button
            type="button"
            onClick={() => void load()}
            aria-label={t("refresh")}
            title={t("refresh")}
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          >
            <RefreshCw size={15} />
          </button>
        </div>
        {overview.status === "ready" ? (
          <div role="tablist" aria-label={t("title")} className="flex gap-1 px-3 sm:px-5">
            <TabButton active={tab === "tables"} onClick={() => setTab("tables")} icon={<Table2 size={14} />} label={t("tabs.tables")} />
            <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={<Users size={14} />} label={t("tabs.users")} />
          </div>
        ) : (
          <div className="h-3" />
        )}
      </header>

      <div className="flex-1 min-h-0 flex">
        {overview.status === "loading" && <Centered>{t("loading")}</Centered>}
        {overview.status === "error" && (
          <Centered>
            <p>{t("loadError")}</p>
            <p className="mt-1 text-[12px] text-zinc-500">{overview.message}</p>
            <button type="button" onClick={() => void load()} className="mt-3 text-[13px] font-medium text-coral-600 hover:underline">
              {t("retry")}
            </button>
          </Centered>
        )}
        {overview.status === "unavailable" && (
          <Centered>
            <p className="text-[14px] font-medium">{t("unavailable.title")}</p>
            <p className="mt-1 max-w-sm text-[13px] text-zinc-500">{t("unavailable.body")}</p>
          </Centered>
        )}
        {(overview.status === "none" || overview.status === "empty") && (
          <Centered>
            <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-900">
              <Database size={20} />
            </span>
            <p className="text-[14px] font-medium">{t("noData.title")}</p>
            <p className="mt-1 max-w-sm text-[13px] text-zinc-500">{t("noData.body")}</p>
          </Centered>
        )}
        {overview.status === "ready" && projectId && (
          tab === "tables" ? (
            <TablesTab projectId={projectId} tables={overview.tables} />
          ) : (
            <UsersTab projectId={projectId} />
          )
        )}
      </div>
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[13px]">{children}</div>;
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${
        active
          ? "border-coral-500 text-coral-600 dark:text-coral-400"
          : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ProjectUrl({ url }: { url: string }) {
  const t = useTranslations("wsChrome.database");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={t("projectUrl")}
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="ml-2 hidden min-w-0 items-center gap-1.5 truncate rounded-md px-2 py-1 font-mono text-[11.5px] text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-900 sm:inline-flex"
    >
      <span className="truncate">{url}</span>
      <span className="shrink-0 text-[11px] font-sans">{copied ? t("copied") : <Copy size={12} />}</span>
    </button>
  );
}

/** Dos clics: el primero arma, el segundo hace. Sin diálogo nativo. */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  icon,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={armed ? confirmLabel : label}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
      className={`inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] transition disabled:opacity-40 ${
        armed ? "bg-red-500 text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-900"
      }`}
    >
      {icon}
      {armed && <span>{confirmLabel}</span>}
    </button>
  );
}

// ─── Tablas ─────────────────────────────────────────────────────────────────

function TablesTab({ projectId, tables }: { projectId: string; tables: readonly TableInfo[] }) {
  const t = useTranslations("wsChrome.database.tables");
  const [selected, setSelected] = useState<string | null>(tables[0]?.name ?? null);
  const table = tables.find((x) => x.name === selected) ?? tables[0] ?? null;

  if (!table) return <Centered>{t("empty")}</Centered>;

  return (
    <>
      <nav aria-label={t("list")} className="w-52 shrink-0 overflow-y-auto nice-scroll border-r border-zinc-200 p-2 dark:border-zinc-800">
        {tables.map((x) => (
          <button
            key={x.name}
            type="button"
            onClick={() => setSelected(x.name)}
            aria-current={x.name === table.name ? "true" : undefined}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition ${
              x.name === table.name ? "bg-zinc-100 font-medium dark:bg-zinc-900" : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900/60"
            }`}
          >
            <Table2 size={13} className="shrink-0 text-zinc-400" />
            <span className="truncate font-mono text-[12.5px]">{x.name}</span>
            {!x.rls && <ShieldAlert size={13} className="ml-auto shrink-0 text-amber-500" aria-label={t("noRls")} />}
          </button>
        ))}
      </nav>
      <RowsGrid key={table.name} projectId={projectId} table={table} />
    </>
  );
}

/** Lo que se escribe en una celda, como valor para Postgres. Vacío es NULL si
 *  la columna lo admite; un JSON se lee como JSON. El resto va como texto y lo
 *  convierte Postgres, como hace PostgREST. */
function parseInput(column: ColumnInfo, text: string): unknown {
  if (text === "") return column.nullable ? null : "";
  if (column.type.startsWith("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

const writable = (c: ColumnInfo) => c.identity !== "always" && !c.generated;

function RowsGrid({ projectId, table }: { projectId: string; table: TableInfo }) {
  const t = useTranslations("wsChrome.database.tables");
  const base = `/api/projects/${projectId}/backend/tables/${encodeURIComponent(table.name)}`;
  const editable = table.primaryKey.length > 0;
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ rows: Row[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ row: number; column: string; value: string } | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await call<{ rows: Row[]; total: number }>(`${base}?offset=${offset}&limit=${PAGE_SIZE}`));
    } catch (e) {
      setError(errorText(e));
    }
  }, [base, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const keyOf = (row: Row) => Object.fromEntries(table.primaryKey.map((c) => [c, row[c]]));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCell = () =>
    run(async () => {
      if (!editing || !data) return;
      const column = table.columns.find((c) => c.name === editing.column)!;
      const { row } = await call<{ row: Row }>(base, {
        method: "PATCH",
        body: JSON.stringify({ key: keyOf(data.rows[editing.row]!), values: { [column.name]: parseInput(column, editing.value) } }),
      });
      setData({ ...data, rows: data.rows.map((r, i) => (i === editing.row ? row : r)) });
      setEditing(null);
    });

  const addRow = () =>
    run(async () => {
      if (!draft) return;
      const values: Record<string, unknown> = {};
      for (const c of table.columns) {
        const text = draft[c.name] ?? "";
        // Vacío = que Postgres ponga su valor por defecto (o NULL).
        if (text !== "") values[c.name] = parseInput(c, text);
      }
      await call(base, { method: "POST", body: JSON.stringify({ values }) });
      setDraft(null);
      await load();
    });

  const removeRow = (row: Row) =>
    run(async () => {
      await call(base, { method: "DELETE", body: JSON.stringify({ key: keyOf(row) }) });
      await load();
    });

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 text-[12px] dark:border-zinc-800">
        <span className="font-mono text-[13px] font-medium">{table.name}</span>
        {table.rls ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
            <ShieldCheck size={12} />
            {t("rls", { count: table.policies })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">
            <ShieldAlert size={12} />
            {t("noRls")}
          </span>
        )}
        {!editable && <span className="text-zinc-500">{t("noKey")}</span>}
        <div className="ml-auto flex items-center gap-2">
          {editable && (
            <button
              type="button"
              disabled={busy || draft !== null}
              onClick={() => setDraft({})}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-zinc-900 px-2.5 text-[12px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              <Plus size={13} />
              {t("addRow")}
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <div className="flex-1 min-h-0 overflow-auto nice-scroll">
        <table className="min-w-full border-separate border-spacing-0 text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-app">
            <tr>
              {table.columns.map((c) => (
                <th key={c.name} scope="col" className="border-b border-r border-zinc-200 px-3 py-1.5 text-left font-medium dark:border-zinc-800">
                  <span className="font-mono">{c.name}</span>
                  <span className="ml-1.5 font-mono text-[11px] font-normal text-zinc-400">{c.type}</span>
                  {table.primaryKey.includes(c.name) && <span className="ml-1 text-[10px] font-normal text-coral-500">PK</span>}
                </th>
              ))}
              {editable && <th aria-hidden className="w-10 border-b border-zinc-200 dark:border-zinc-800" />}
            </tr>
          </thead>
          <tbody>
            {draft && (
              <tr className="bg-coral-500/5">
                {table.columns.map((c) => (
                  <td key={c.name} className="border-b border-r border-zinc-200 p-1 dark:border-zinc-800">
                    {writable(c) ? (
                      <input
                        aria-label={c.name}
                        value={draft[c.name] ?? ""}
                        placeholder={c.hasDefault || c.identity ? t("defaultHint") : c.nullable ? "NULL" : ""}
                        onChange={(e) => setDraft({ ...draft, [c.name]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void addRow();
                          if (e.key === "Escape") setDraft(null);
                        }}
                        className="h-7 w-full min-w-24 rounded bg-[color:var(--bg)] px-2 font-mono text-[12px] ring-1 ring-zinc-300 focus:outline-none focus:ring-2 focus:ring-coral-500 dark:ring-zinc-700"
                      />
                    ) : (
                      <span className="px-2 text-[11px] text-zinc-400">{t("defaultHint")}</span>
                    )}
                  </td>
                ))}
                <td className="border-b border-zinc-200 p-1 dark:border-zinc-800">
                  <div className="flex gap-1">
                    <button type="button" disabled={busy} onClick={() => void addRow()} className="h-7 rounded-md bg-coral-500 px-2 text-[12px] font-medium text-white disabled:opacity-40">
                      {t("save")}
                    </button>
                    <button type="button" onClick={() => setDraft(null)} className="h-7 rounded-md px-2 text-[12px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                      {t("cancel")}
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {data?.rows.map((row, i) => (
              <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                {table.columns.map((c) => {
                  const isEditing = editing?.row === i && editing.column === c.name;
                  const v = row[c.name];
                  const canEdit = editable && writable(c) && !table.primaryKey.includes(c.name);
                  return (
                    <td
                      key={c.name}
                      onClick={() => canEdit && !isEditing && setEditing({ row: i, column: c.name, value: cellText(v) })}
                      className={`max-w-72 border-b border-r border-zinc-200 px-3 py-1.5 align-top dark:border-zinc-800 ${canEdit ? "cursor-text" : ""}`}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          aria-label={c.name}
                          value={editing.value}
                          disabled={busy}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveCell();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          onBlur={() => setEditing(null)}
                          className="h-6 w-full min-w-24 rounded bg-[color:var(--bg)] px-1.5 font-mono text-[12px] ring-2 ring-coral-500 focus:outline-none"
                        />
                      ) : v === null || v === undefined ? (
                        <span className="font-mono text-[11px] text-zinc-400">NULL</span>
                      ) : (
                        <span className="block truncate font-mono" title={cellText(v)}>
                          {cellText(v)}
                        </span>
                      )}
                    </td>
                  );
                })}
                {editable && (
                  <td className="border-b border-zinc-200 px-1 dark:border-zinc-800">
                    <ConfirmButton label={t("delete")} confirmLabel={t("confirmDelete")} icon={<Trash2 size={13} />} disabled={busy} onConfirm={() => void removeRow(row)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.rows.length === 0 && !draft && <p className="p-6 text-center text-[13px] text-zinc-500">{t("noRows")}</p>}
      </div>

      <footer className="flex items-center gap-2 border-t border-zinc-200 px-4 py-1.5 text-[12px] text-zinc-500 dark:border-zinc-800">
        {editable && <span className="hidden sm:inline">{t("editHint")}</span>}
        <span className="ml-auto tabular-nums">{t("range", { from, to, total })}</span>
        <button type="button" aria-label={t("prev")} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900">
          <ChevronLeft size={14} />
        </button>
        <button type="button" aria-label={t("next")} disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900">
          <ChevronRight size={14} />
        </button>
      </footer>
    </div>
  );
}

// ─── Usuarios ───────────────────────────────────────────────────────────────

function UsersTab({ projectId }: { projectId: string }) {
  const t = useTranslations("wsChrome.database.users");
  const tDb = useTranslations("wsChrome.database");
  const locale = useLocale();
  const base = `/api/projects/${projectId}/backend/users`;
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ users: PanelUser[]; total: number } | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const when = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await call<{ users: PanelUser[]; total: number }>(`${base}?page=${page}`));
    } catch (e) {
      setError(errorText(e));
    }
  }, [base, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const invite = () =>
    run(async () => {
      const to = email.trim();
      await call(base, { method: "POST", body: JSON.stringify({ email: to }) });
      setEmail("");
      return t("inviteSent", { email: to });
    });

  const status = (u: PanelUser) =>
    u.banned ? t("status.banned") : u.confirmed ? t("status.confirmed") : u.invited ? t("status.invited") : t("status.unconfirmed");

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void invite();
        }}
        className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"
      >
        <span className="text-[12px] text-zinc-500">{data ? t("total", { count: data.total }) : ""}</span>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("invitePlaceholder")}
            aria-label={t("invitePlaceholder")}
            className="h-7 min-w-0 flex-1 rounded-md bg-[color:var(--bg)] px-2.5 sm:w-56 sm:flex-none text-[12px] ring-1 ring-zinc-300 focus:outline-none focus:ring-2 focus:ring-coral-500 dark:ring-zinc-700"
          />
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-zinc-900 px-2.5 text-[12px] font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <Plus size={13} />
            {t("invite")}
          </button>
        </div>
      </form>
      {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-[12px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}

      <div className="flex-1 min-h-0 overflow-auto nice-scroll">
        {!data && !error ? (
          <p className="p-8 text-center text-[13px] text-zinc-500">{tDb("loading")}</p>
        ) : data && data.users.length === 0 ? (
          <p className="p-8 text-center text-[13px] text-zinc-500">{t("empty")}</p>
        ) : (
          <table className="min-w-full border-separate border-spacing-0 text-[12.5px]">
            <thead className="sticky top-0 bg-app">
              <tr>
                {[t("email"), t("statusHeader"), t("created"), t("lastSignIn")].map((h) => (
                  <th key={h} scope="col" className="border-b border-zinc-200 px-4 py-1.5 text-left font-medium dark:border-zinc-800">
                    {h}
                  </th>
                ))}
                <th aria-hidden className="border-b border-zinc-200 dark:border-zinc-800" />
              </tr>
            </thead>
            <tbody>
              {data?.users.map((u) => (
                <tr key={u.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                  <td className="border-b border-zinc-200 px-4 py-2 font-mono dark:border-zinc-800">{u.email ?? "—"}</td>
                  <td className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">{status(u)}</td>
                  <td className="border-b border-zinc-200 px-4 py-2 tabular-nums text-zinc-500 dark:border-zinc-800">{when.format(new Date(u.createdAt))}</td>
                  <td className="border-b border-zinc-200 px-4 py-2 tabular-nums text-zinc-500 dark:border-zinc-800">
                    {u.lastSignInAt ? when.format(new Date(u.lastSignInAt)) : t("never")}
                  </td>
                  <td className="border-b border-zinc-200 px-2 py-1 text-right dark:border-zinc-800">
                    <div className="inline-flex gap-1">
                      <ConfirmButton
                        label={t("signOut")}
                        confirmLabel={t("confirm")}
                        icon={<LogOut size={13} />}
                        disabled={busy}
                        onConfirm={() =>
                          void run(async () => {
                            await call(`${base}/${u.id}?only=sessions`, { method: "DELETE" });
                            return t("signedOut", { email: u.email ?? "" });
                          })
                        }
                      />
                      <ConfirmButton
                        label={t("delete")}
                        confirmLabel={t("confirm")}
                        icon={<Trash2 size={13} />}
                        disabled={busy}
                        onConfirm={() =>
                          void run(async () => {
                            await call(`${base}/${u.id}`, { method: "DELETE" });
                            return t("deleted", { email: u.email ?? "" });
                          })
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-1.5 text-[12px] text-zinc-500 dark:border-zinc-800">
          <span className="tabular-nums">{t("page", { page, pages })}</span>
          <button type="button" aria-label={t("prev")} disabled={page <= 1} onClick={() => setPage(page - 1)} className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900">
            <ChevronLeft size={14} />
          </button>
          <button type="button" aria-label={t("next")} disabled={page >= pages} onClick={() => setPage(page + 1)} className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900">
            <ChevronRight size={14} />
          </button>
        </footer>
      )}
    </div>
  );
}
