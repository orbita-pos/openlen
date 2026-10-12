"use client";
// LOS SECRETOS DE LAS EDGE FUNCTIONS, en la vista Base de datos (spec local
// 2026-10-11, Parte 4, «Gestión fuera del chat»): por entorno, nombre, huella y
// fecha; añadir, reemplazar y borrar. Los valores van a la ruta de secretos y
// no vuelven NUNCA: aquí sólo se escriben (reemplazar no pide el viejo).

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";

import { secretNameProblem } from "@/lib/functions/secret-names";
import { postFunctionSecrets, type SecretEnvironment } from "@/lib/workspace-v2/function-secrets-request";
import { saveErrorText, SecretFieldsView } from "./chat/secrets-card";
import { ConfirmButton } from "./confirm-button";

type Translate = (key: string, values?: Record<string, string>) => string;
type Row = { readonly name: string; readonly digest?: string; readonly updatedAt?: string };
type Listing = { readonly draft: readonly Row[]; readonly live: readonly Row[] };

const ruta = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/function-secrets`;

export function SecretsTab({ projectId }: { projectId: string }) {
  const t = useTranslations("wsChrome.database.secrets");
  const tc = useTranslations("panelsChat");
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch(ruta(projectId), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { draft?: Row[]; live?: Row[] };
      setData({ draft: body.draft ?? [], live: body.live ?? [] });
      setError(false);
    } catch {
      setError(true);
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  const tt: Translate = (k, v) => t(k as never, v as never);
  const tr: Translate = (k, v) => tc(k as never, v as never);
  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5">
      <p className="mb-4 max-w-xl text-[12.5px] text-zinc-500">{t("hint")}</p>
      {error && (
        <p role="alert" className="mb-3 text-[12.5px] text-red-600 dark:text-red-400">
          {t("loadError")}
        </p>
      )}
      {data && (["draft", "live"] as const).map((env) => <EnvSecrets key={env} projectId={projectId} env={env} rows={data[env]} onChanged={load} t={tt} tr={tr} />)}
    </div>
  );
}

function EnvSecrets({
  projectId,
  env,
  rows,
  onChanged,
  t,
  tr,
}: {
  projectId: string;
  env: SecretEnvironment;
  rows: readonly Row[];
  onChanged: () => Promise<void>;
  t: Translate;
  tr: Translate;
}) {
  const locale = useLocale();
  const [nombre, setNombre] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titulo = t(env === "draft" ? "draft" : "live");
  const cambiar = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  /** `clave` es la de sus campos en `values` (la de `SecretFieldsView`). */
  const save = async (name: string, clave: string) => {
    // Recortado: un salto de línea al copiar una clave rompe su autenticación.
    const value = (values[`${clave}:${env}`] ?? "").trim();
    if (!value) return;
    if (secretNameProblem(name)) {
      setError(tr("functionSecrets.invalidName"));
      return;
    }
    setBusy(true);
    setError(null);
    const r = await postFunctionSecrets(projectId, [{ environment: env, name, value }]);
    setBusy(false);
    if (r.kind !== "saved") {
      setError(saveErrorText(r, tr));
      return;
    }
    setValues({});
    setNombre("");
    setReplacing(null);
    await onChanged();
  };
  const remove = async (name: string) => {
    setBusy(true);
    setError(null);
    const res = await fetch(ruta(projectId), { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ environment: env, names: [name] }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t("deleteFailed"));
      return;
    }
    await onChanged();
  };
  const filled = (clave: string) => (values[`${clave}:${env}`] ?? "").trim().length > 0;

  return (
    <section className="mb-6 max-w-xl">
      <h2 className="mb-2 text-[13px] font-semibold">{titulo}</h2>
      {rows.length === 0 ? (
        <p className="mb-2 text-[12.5px] text-zinc-500">{t("empty")}</p>
      ) : (
        <ul className="mb-3 divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
          {rows.map((r) => (
            <li key={r.name} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <code className="font-mono text-[12.5px]">{r.name}</code>
                {r.digest && (
                  <span title={r.digest} className="font-mono text-[11px] text-zinc-400">
                    {r.digest.slice(0, 12)}
                  </span>
                )}
                {r.updatedAt && <span className="text-[11px] text-zinc-400">{new Date(r.updatedAt).toLocaleDateString(locale)}</span>}
                <button
                  type="button"
                  onClick={() => setReplacing(replacing === r.name ? null : r.name)}
                  disabled={busy}
                  className="ml-auto text-[12px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  {t("replace")}
                </button>
                <ConfirmButton label={t("delete")} confirmLabel={t("confirmDelete")} icon={<Trash2 size={13} />} disabled={busy} onConfirm={() => void remove(r.name)} />
              </div>
              {replacing === r.name && (
                <div className="mt-2 flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <SecretFieldsView secret={{ name: r.name, description: "" }} keyName={`replace-${r.name}`} showHeader={false} environments={[env]} values={values} onChange={cambiar} disabled={busy} t={tr} />
                  </div>
                  <button
                    type="button"
                    onClick={() => void save(r.name, `replace-${r.name}`)}
                    disabled={busy || !filled(`replace-${r.name}`)}
                    className="h-8 rounded-md bg-coral-500 px-3 text-[12px] font-medium text-white disabled:opacity-50"
                  >
                    {t("save")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] text-zinc-500">{t("nameField")}</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value.toUpperCase())}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            aria-label={`${titulo} · ${t("nameField")}`}
            className="h-8 w-56 rounded-md border border-zinc-200 bg-transparent px-2 font-mono text-[12px] outline-none dark:border-zinc-800"
          />
        </label>
        <div className="min-w-[14rem] flex-1">
          <SecretFieldsView secret={{ name: nombre || "…", description: "" }} keyName="nuevo" showHeader={false} environments={[env]} values={values} onChange={cambiar} disabled={busy} t={tr} />
        </div>
        <button
          type="button"
          onClick={() => void save(nombre.trim(), "nuevo")}
          disabled={busy || !nombre.trim() || !filled("nuevo")}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-coral-500 px-3 text-[12px] font-medium text-white disabled:opacity-50"
        >
          <Plus size={13} />
          {t("add")}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
