"use client";

/**
 * LAS VARIABLES DE ENTORNO DE UNA APP (spec local
 * docs/superpowers/specs/2026-10-10-variables-de-entorno-design.md): lo que la
 * app lee con `import.meta.env.VITE_X`, por entorno —Borrador (el lienzo, Len,
 * la terminal) y Producción (la publicada)—, y debajo, de sólo lectura, lo de
 * `/.env` y lo de OpenLen. TODO es público: el aviso de «parece un secreto» no
 * se salta. Quién puede cambiarlas lo decide el servidor
 * (`/api/projects/[id]/env`); esto pinta lo que devuelve.
 */
import { useCallback, useEffect, useState, type ClipboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";

import { parseDotEnv } from "@/lib/apps/env/dotenv";
import {
  DOTENV_PATH,
  ENV_TARGETS,
  applyGroupEdit,
  groupEnvVars,
  validateEnvVars,
  type EnvTarget,
  type EnvVarGroup,
  type EnvVarProblem,
  type StoredEnvVar,
} from "@/lib/apps/env/rules";
import { SECRET_PROVIDER } from "@/lib/apps/env/secret-patterns";
import { abrirEnElCodigo } from "@/lib/workspace-v2/abrir-fichero";
import { notifyEnvVarsChanged } from "@/lib/workspace-v2/env-vars-signal";
import { ModalShell } from "./modal-shell";
import { Button } from "./ui";

interface EnvState {
  readonly vars: readonly StoredEnvVar[];
  readonly fromFile: readonly { readonly name: string; readonly value: string; readonly overridden: readonly EnvTarget[] }[];
  readonly platform: readonly { readonly name: string; readonly value: string }[];
  readonly version: string;
  readonly published: boolean;
  readonly pendingPublish: boolean;
}

interface Line {
  readonly name: string;
  readonly value: string;
}

interface Draft {
  /** La fila que se edita, o `null` al añadir. */
  readonly editing: EnvVarGroup | null;
  readonly lines: readonly Line[];
  readonly targets: readonly EnvTarget[];
  readonly acknowledged: boolean;
}

type SecretProblem = Extract<EnvVarProblem, { code: "looks_like_secret" }>;
type NameProblem = Extract<EnvVarProblem, { code: "name_format" }>;

const NEW_DRAFT: Draft = { editing: null, lines: [{ name: "", value: "" }], targets: ENV_TARGETS, acknowledged: false };
const MASK = "••••••••";
const ROW = "flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]";
const LIST = "flex flex-col divide-y divide-[color:var(--border)] rounded-lg border bd";
const ICON_BTN = "grid h-7 w-7 shrink-0 place-items-center rounded-md fg-muted hover:bg-hover hover:fg";
const INPUT = "h-8 min-w-0 flex-1 rounded-lg border bd bg-app px-2.5 font-mono text-[12.5px] fg outline-none focus:border-[color:var(--accent)]";
const DANGER = "text-[color:var(--danger,#e5484d)]";

export function EnvVarsDialog({
  projectId,
  open,
  onClose,
  readOnly = false,
  onPublish,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  /** Un lector (lib/projects/acceso.ts): ve la lista, sin botones. */
  readOnly?: boolean;
  /** Abre publicar, para la franja de «la publicada sigue con los valores de antes». */
  onPublish?: () => void;
}) {
  const t = useTranslations("topbar");
  const [state, setState] = useState<EnvState | "loading" | "error">("loading");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());

  const url = `/api/projects/${encodeURIComponent(projectId)}/env`;
  const load = useCallback(async () => {
    const r = await fetch(url).catch(() => null);
    if (!r?.ok) return setState("error");
    setState((await r.json()) as EnvState);
  }, [url]);
  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setDraft(null);
    void load();
  }, [open, load]);

  const stored: StoredEnvVar[] = typeof state === "object" ? state.vars.map(({ name, target, value }) => ({ name, target, value })) : [];
  const groups = groupEnvVars(stored);

  const targetLabel = (target: EnvTarget) => (target === "draft" ? t("envVars.draft") : t("envVars.production"));
  const targetHint = (target: EnvTarget) => (target === "draft" ? t("envVars.draftHint") : t("envVars.productionHint"));
  const problemText = (p: EnvVarProblem): string => {
    switch (p.code) {
      case "name_format":
        return t("envVars.errors.name");
      case "name_too_long":
        return t("envVars.errors.nameTooLong");
      case "reserved":
        return t("envVars.errors.reserved", { name: p.name });
      case "duplicate":
        return t("envVars.errors.duplicate", { name: p.name, target: targetLabel(p.target) });
      case "value_too_long":
        return t("envVars.errors.tooLong");
      case "too_many":
        return t("envVars.errors.tooMany", { max: p.max });
      case "looks_like_secret":
        return p.kind === "secret_name"
          ? t("envVars.secret.byName")
          : p.kind === "private_key"
            ? t("envVars.secret.privateKey")
            : t("envVars.secret.byValue", { provider: SECRET_PROVIDER[p.kind] });
    }
  };

  // Lo que se guardaría con el formulario, y lo que le falta.
  const named = draft ? draft.lines.filter((l) => l.name.trim() !== "") : [];
  const proposed = draft ? applyGroupEdit(stored, draft.editing, { lines: named, targets: draft.targets }) : [];
  const problems = draft ? validateEnvVars(proposed, stored) : [];
  const secrets = problems.filter((p): p is SecretProblem => p.code === "looks_like_secret");
  const blocking = problems.filter((p) => p.code !== "looks_like_secret");
  const canSave =
    draft !== null && named.length > 0 && draft.targets.length > 0 && blocking.length === 0 && (secrets.length === 0 || draft.acknowledged);

  const put = async (vars: readonly StoredEnvVar[], acknowledged: boolean): Promise<boolean> => {
    if (typeof state !== "object") return false;
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: state.version, vars: vars.map((v) => (acknowledged ? { ...v, acknowledgedPublic: true } : v)) }),
      }).catch(() => null);
      const body = r ? ((await r.json().catch(() => null)) as EnvState | null) : null;
      if (r?.status === 409 && body) {
        setState(body);
        setNotice(t("envVars.errors.conflict"));
        return false;
      }
      if (!r?.ok || !body) {
        setNotice(t("envVars.errors.generic"));
        return false;
      }
      setState(body);
      notifyEnvVarsChanged(projectId);
      return true;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!draft || !canSave) return;
    if (await put(proposed, draft.acknowledged)) setDraft(null);
  };
  const remove = async (g: EnvVarGroup) => {
    if (!window.confirm(t("envVars.confirmDelete", { name: g.name }))) return;
    await put(applyGroupEdit(stored, g, { lines: [], targets: [] }), false);
  };

  const setLine = (i: number, patch: Partial<Line>) =>
    setDraft((d) => d && { ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const pasteIntoName = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.includes("=")) return; // un nombre suelto: se pega como siempre
    const entries = parseDotEnv(pasted).entries;
    if (entries.length === 0) return;
    e.preventDefault();
    const lines = [...new Map(entries.map((en) => [en.name, en.value]))].map(([name, value]) => ({ name, value }));
    setDraft((d) => d && { ...d, lines: [...d.lines.slice(0, i), ...lines, ...d.lines.slice(i + 1)] });
  };
  const toggleTarget = (target: EnvTarget) =>
    setDraft(
      (d) =>
        d && {
          ...d,
          targets: d.targets.includes(target) ? d.targets.filter((x) => x !== target) : ENV_TARGETS.filter((x) => x === target || d.targets.includes(x)),
        },
    );
  const toggleShown = (key: string) =>
    setShown((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const valueCell = (key: string, value: string) => (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <code className="min-w-0 truncate font-mono text-[12px] fg-muted">{shown.has(key) ? value || " " : MASK}</code>
      <button
        type="button"
        onClick={() => toggleShown(key)}
        aria-label={shown.has(key) ? t("envVars.hide") : t("envVars.show")}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md fg-faint hover:bg-hover hover:fg"
      >
        {shown.has(key) ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
    </span>
  );

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      titleId="variables-de-entorno"
      title={t("envVars.title")}
      subtitle={t("envVars.subtitle")}
      size="lg"
      closeLabel={t("envVars.close")}
    >
      {state === "loading" ? (
        <p className="px-4 sm:px-5 py-6 text-[13px] fg-muted">{t("envVars.loading")}</p>
      ) : state === "error" ? (
        <p className="px-4 sm:px-5 py-6 text-[13px] fg-muted">{t("envVars.errors.generic")}</p>
      ) : (
        <div className="flex flex-col gap-4 overflow-y-auto px-4 sm:px-5 pt-4 pb-5">
          {state.pendingPublish && (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border bd bg-app px-3 py-2 text-[12.5px] fg">
              <span className="min-w-0 flex-1">{t("envVars.publish.notice")}</span>
              {onPublish && !readOnly && (
                <Button size="sm" onClick={onPublish}>
                  {t("envVars.publish.button")}
                </Button>
              )}
            </div>
          )}

          {notice && (
            <p role="alert" className={`text-[12px] ${DANGER}`}>
              {notice}
            </p>
          )}

          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-[12px] font-medium fg">{t("envVars.yours")}</h3>
              {!readOnly && !draft && (
                <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => setDraft(NEW_DRAFT)}>
                  <Plus size={13} />
                  {t("envVars.add")}
                </Button>
              )}
            </div>

            {groups.length === 0 && !draft && <p className="text-[12.5px] fg-muted">{t("envVars.empty")}</p>}

            {groups.length > 0 && (
              <ul className={LIST}>
                {groups.map((g) => {
                  const key = `${g.name}\u0000${g.value}`;
                  return (
                    <li key={key} data-env-group={g.name} className={ROW}>
                      <code className="min-w-0 max-w-[45%] truncate font-mono text-[12.5px] fg">{g.name}</code>
                      {valueCell(key, g.value)}
                      <span className="flex items-center gap-1">
                        {g.targets.map((target) => (
                          <span key={target} title={targetHint(target)} className="rounded-md border bd px-1.5 py-0.5 text-[11px] fg-muted">
                            {targetLabel(target)}
                          </span>
                        ))}
                        {!readOnly && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setDraft({ editing: g, lines: [{ name: g.name, value: g.value }], targets: g.targets, acknowledged: false })}
                              aria-label={t("envVars.edit", { name: g.name })}
                              className={ICON_BTN}
                            >
                              <Pencil size={13} />
                            </button>
                            <button type="button" disabled={busy} onClick={() => void remove(g)} aria-label={t("envVars.delete", { name: g.name })} className={ICON_BTN}>
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {draft && (
              <form
                data-env-form=""
                className="flex flex-col gap-2 rounded-lg border bd p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                {draft.lines.map((line, i) => {
                  const suggestion =
                    problems.find((p): p is NameProblem => p.code === "name_format" && p.name === line.name.trim())?.suggestion ?? null;
                  return (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex gap-2">
                        <input
                          value={line.name}
                          onChange={(e) => setLine(i, { name: e.target.value })}
                          onPaste={(e) => pasteIntoName(i, e)}
                          placeholder="VITE_STRIPE_PUBLISHABLE_KEY"
                          aria-label={t("envVars.name")}
                          spellCheck={false}
                          autoComplete="off"
                          className={INPUT}
                        />
                        <input
                          value={line.value}
                          onChange={(e) => setLine(i, { value: e.target.value })}
                          placeholder={t("envVars.value")}
                          aria-label={t("envVars.value")}
                          spellCheck={false}
                          autoComplete="off"
                          className={INPUT}
                        />
                        {draft.lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setDraft((d) => d && { ...d, lines: d.lines.filter((_, j) => j !== i) })}
                            aria-label={t("envVars.removeLine")}
                            className={ICON_BTN}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                      {suggestion && (
                        <p className="flex items-center gap-2 text-[11.5px] fg-muted">
                          {t("envVars.didYouMean", { name: suggestion })}
                          <button type="button" onClick={() => setLine(i, { name: suggestion })} className="font-medium text-accent hover:underline">
                            {t("envVars.useIt")}
                          </button>
                        </p>
                      )}
                    </div>
                  );
                })}

                {!draft.editing && (
                  <>
                    <button
                      type="button"
                      onClick={() => setDraft((d) => d && { ...d, lines: [...d.lines, { name: "", value: "" }] })}
                      className="self-start text-[12px] font-medium fg-muted hover:fg"
                    >
                      + {t("envVars.addAnother")}
                    </button>
                    <p className="text-[11.5px] fg-faint">{t("envVars.pasteHint")}</p>
                  </>
                )}

                <div className="flex flex-wrap gap-3">
                  {ENV_TARGETS.map((target) => (
                    <label key={target} className="flex items-center gap-1.5 text-[12.5px] fg">
                      <input type="checkbox" checked={draft.targets.includes(target)} onChange={() => toggleTarget(target)} />
                      {targetLabel(target)}
                      <span className="text-[11px] fg-faint">· {targetHint(target)}</span>
                    </label>
                  ))}
                </div>

                {draft.targets.length === 0 && <p className={`text-[12px] ${DANGER}`}>{t("envVars.errors.noTarget")}</p>}
                {[...new Set(blocking.map(problemText))].map((msg) => (
                  <p key={msg} className={`text-[12px] ${DANGER}`}>
                    {msg}
                  </p>
                ))}

                {secrets.length > 0 && (
                  <div role="alert" data-env-secreto="" className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--danger,#e5484d)] px-3 py-2 text-[12.5px]">
                    {[...new Set(secrets.map(problemText))].map((msg) => (
                      <p key={msg} className={`font-medium ${DANGER}`}>
                        {msg}
                      </p>
                    ))}
                    <p className="fg-muted">{t("envVars.secret.explanation")}</p>
                    <label className="flex items-center gap-1.5 fg">
                      <input type="checkbox" checked={draft.acknowledged} onChange={(e) => setDraft((d) => d && { ...d, acknowledged: e.target.checked })} />
                      {t("envVars.secret.understood")}
                    </label>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setDraft(null)}>
                    {t("envVars.cancel")}
                  </Button>
                  <Button type="submit" disabled={busy || !canSave}>
                    {t("envVars.save")}
                  </Button>
                </div>
              </form>
            )}
          </section>

          {state.fromFile.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-[12px] font-medium fg">{t("envVars.fromCode")}</h3>
                <button
                  type="button"
                  onClick={() => {
                    abrirEnElCodigo.abrir(projectId, DOTENV_PATH);
                    onClose();
                  }}
                  className="ml-auto text-[12px] font-medium text-accent hover:underline"
                >
                  {t("envVars.open")}
                </button>
              </div>
              <p className="text-[11.5px] fg-faint">{t("envVars.fromCodeHint")}</p>
              <ul className={LIST}>
                {state.fromFile.map((f) => (
                  <li key={f.name} data-env-file={f.name} className={ROW}>
                    <code className="min-w-0 max-w-[45%] truncate font-mono text-[12.5px] fg">{f.name}</code>
                    {valueCell(`file\u0000${f.name}`, f.value)}
                    {f.overridden.length > 0 && (
                      <span className="text-[11.5px] fg-faint">{t("envVars.overridden", { targets: f.overridden.map(targetLabel).join(", ") })}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {state.platform.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-[12px] font-medium fg">{t("envVars.fromOpenLen")}</h3>
              <p className="text-[11.5px] fg-faint">{t("envVars.fromOpenLenHint")}</p>
              <ul className={LIST}>
                {state.platform.map((p) => (
                  <li key={p.name} data-env-platform={p.name} className={ROW}>
                    <code className="min-w-0 max-w-[45%] truncate font-mono text-[12.5px] fg">{p.name}</code>
                    <code className="min-w-0 flex-1 truncate font-mono text-[12px] fg-muted">{p.value}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {readOnly && <p className="text-[11.5px] fg-faint">{t("envVars.readOnly")}</p>}
        </div>
      )}
    </ModalShell>
  );
}
