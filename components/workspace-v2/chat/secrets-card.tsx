"use client";

// LA TARJETA SEGURA DE LOS SECRETOS (spec local 2026-10-11, Parte 4). Lo que Len
// pide con `request_secrets`: dos campos por secreto —para probar (borrador) y
// para la publicada— que van DIRECTOS a la ruta de secretos. Al turno sólo sube
// qué se guardó dónde (`NOMBRE:draft`), nunca un valor. Los campos también los
// usan «Guardar como secreto» del compositor y los que faltan al publicar.

import { useState } from "react";
import { AlertTriangle, Check, ExternalLink, KeyRound, Loader, X } from "lucide-react";

import type { QuestionAnswer, SecretRequest } from "@/lib/agent/ask-user-question";
import { secretModeWarning } from "@/lib/apps/env/secret-patterns";
import { postFunctionSecrets, type SaveSecretsOutcome, type SecretEnvironment, type SecretInput } from "@/lib/workspace-v2/function-secrets-request";

type Translate = (key: string, values?: Record<string, string>) => string;

export const SECRETS_QUESTION_ID = "secrets";
const ENTORNOS: readonly SecretEnvironment[] = ["draft", "live"];
const claveDe = (name: string, env: SecretEnvironment) => `${name}:${env}`;
const envKey = (env: SecretEnvironment) => (env === "draft" ? "functionSecrets.envDraft" : "functionSecrets.envLive");

export function saveErrorText(o: Exclude<SaveSecretsOutcome, { kind: "saved" }>, t: Translate): string {
  if (o.kind === "too_large") return t("functionSecrets.tooLarge", { available: String(o.availableBytes), environment: t(envKey(o.environment)) });
  if (o.kind === "invalid_name") return t("functionSecrets.invalidName");
  return t("functionSecrets.saveFailed");
}

/** Lo que se guardaría: los campos con algo, RECORTADOS (un salto de línea al
 *  copiar una clave del panel rompe su autenticación). */
export function secretInputs(
  secrets: readonly Pick<SecretRequest, "name">[],
  environments: readonly SecretEnvironment[],
  values: Readonly<Record<string, string>>,
  keyName?: string,
): SecretInput[] {
  return secrets
    .flatMap((s) => environments.map((environment) => ({ environment, name: s.name, value: (values[claveDe(keyName ?? s.name, environment)] ?? "").trim() })))
    .filter((x) => x.value.length > 0);
}

/** «Guardado: STRIPE_SECRET_KEY (borrador, producción)» de lo que contestó la
 *  tarjeta (`NOMBRE:entorno`); otra respuesta (la que salió como mensaje), tal cual. */
export function savedSummary(answer: string, t: Translate): string {
  const partes = answer.split(", ").filter(Boolean);
  if (partes.length === 0) return t("functionSecrets.skipped");
  const porNombre = new Map<string, string[]>();
  for (const p of partes) {
    const m = /^([A-Za-z][A-Za-z0-9_]*):(draft|live)$/.exec(p);
    if (!m) return answer;
    porNombre.set(m[1]!, [...(porNombre.get(m[1]!) ?? []), t(envKey(m[2] as SecretEnvironment))]);
  }
  return t("functionSecrets.answered", { list: [...porNombre].map(([n, e]) => `${n} (${e.join(", ")})`).join(", ") });
}

/** Los campos de UN secreto: su nombre, para qué, dónde sacarlo, y uno por
 *  entorno — de contraseña y sin autocompletar —, con el aviso de prueba/real. */
export function SecretFieldsView({
  secret,
  keyName,
  showHeader = true,
  environments,
  values,
  onChange,
  disabled,
  t,
}: {
  secret: Pick<SecretRequest, "name" | "description" | "url">;
  /** La clave de sus valores en `values`; por defecto, su nombre (el diálogo lo deja fijo mientras se escribe el nombre). */
  keyName?: string;
  showHeader?: boolean;
  environments: readonly SecretEnvironment[];
  values: Readonly<Record<string, string>>;
  onChange: (key: string, value: string) => void;
  disabled: boolean;
  t: Translate;
}) {
  const k = keyName ?? secret.name;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {showHeader && (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <code className="text-[12.5px] font-semibold fg">{secret.name}</code>
          {secret.url ? (
            <a href={secret.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[11.5px] text-[var(--nc-accent-text)] hover:underline">
              {t("functionSecrets.whereToGet")}
              <ExternalLink size={10} />
            </a>
          ) : null}
        </div>
      )}
      {showHeader && secret.description ? <p className="m-0 text-[12px] leading-snug fg-muted">{secret.description}</p> : null}
      {environments.map((env) => {
        const valor = values[claveDe(k, env)] ?? "";
        const aviso = valor.trim() ? secretModeWarning(env, valor) : null;
        const etiqueta = t(env === "draft" ? "functionSecrets.draftField" : "functionSecrets.liveField");
        return (
          <label key={env} className="flex flex-col gap-1">
            <span className="text-[11.5px] fg-muted">
              {etiqueta}
              {env === "live" && environments.length > 1 ? <span className="fg-faint"> · {t("functionSecrets.liveLater")}</span> : null}
            </span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore=""
              data-lpignore="true"
              aria-label={`${secret.name} · ${etiqueta}`}
              disabled={disabled}
              value={valor}
              onChange={(e) => onChange(claveDe(k, env), e.target.value)}
              className="h-8 rounded-md border bd bg-app px-2 font-mono text-[12px] fg outline-none"
            />
            {aviso ? (
              <span role="note" className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                {t(aviso === "live_in_draft" ? "functionSecrets.liveInDraft" : "functionSecrets.testInLive")}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

export function SecretsCardView({
  projectId,
  secrets,
  answer,
  cancelled,
  onAnswer,
  save = postFunctionSecrets,
  t,
}: {
  projectId: string | null;
  secrets: readonly SecretRequest[];
  answer: string | null;
  cancelled?: boolean;
  onAnswer?: (answers: QuestionAnswer[]) => void;
  save?: (projectId: string, secrets: readonly SecretInput[]) => Promise<SaveSecretsOutcome>;
  t: Translate;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [estado, setEstado] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "error"; text: string } | { kind: "sent" }>({ kind: "idle" });

  if (answer !== null || cancelled) {
    return (
      <div className="nc-up flex min-w-0 items-center gap-2 rounded-[10px] border bd bg-elev px-2.5 py-1.5 text-[12px] fg-muted">
        {cancelled ? <X size={13} className="shrink-0 fg-faint" /> : <Check size={13} className="nc-ok shrink-0" />}
        <span className="min-w-0 truncate">{cancelled ? t("newChat.question.cancelled") : savedSummary(answer ?? "", t)}</span>
      </div>
    );
  }

  const contestable = Boolean(onAnswer && projectId) && estado.kind !== "sent";
  const contestar = (selected: string[]) => {
    setEstado({ kind: "sent" });
    onAnswer?.([{ id: SECRETS_QUESTION_ID, selected }]);
  };
  const guardar = async () => {
    if (!contestable || !projectId) return;
    const entradas = secretInputs(secrets, ENTORNOS, values);
    if (entradas.length === 0) {
      contestar([]);
      return;
    }
    setEstado({ kind: "saving" });
    const r = await save(projectId, entradas);
    if (r.kind !== "saved") {
      setEstado({ kind: "error", text: saveErrorText(r, t) });
      return;
    }
    // Del valor no queda nada en la tarjeta: lo que sube al turno son nombres.
    setValues({});
    contestar(entradas.map((e) => claveDe(e.name, e.environment)));
  };

  return (
    <div className="nc-ask px-3.5 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--nc-accent-text)]">
        <KeyRound size={13} />
        {t("functionSecrets.cardLabel")}
      </div>
      <p className="m-0 mb-2 text-[11.5px] fg-muted">{t("functionSecrets.cardHint")}</p>
      <div className="flex flex-col gap-3">
        {secrets.map((s) => (
          <SecretFieldsView
            key={s.name}
            secret={s}
            environments={ENTORNOS}
            values={values}
            onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
            disabled={!contestable || estado.kind === "saving"}
            t={t}
          />
        ))}
      </div>
      {estado.kind === "error" ? (
        <p role="alert" className="m-0 mt-2 text-[11.5px] text-red-600 dark:text-red-400">
          {estado.text}
        </p>
      ) : null}
      {contestable ? (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={estado.kind === "saving"}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white disabled:opacity-50"
          >
            {estado.kind === "saving" ? (
              <>
                <Loader size={12} className="animate-spin" />
                {t("functionSecrets.saving")}
              </>
            ) : (
              t("functionSecrets.save")
            )}
          </button>
          <button type="button" onClick={() => contestar([])} disabled={estado.kind === "saving"} className="h-7 rounded-md px-2.5 text-[11.5px] font-medium fg-faint hover:bg-hover hover:fg">
            {t("functionSecrets.skip")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
