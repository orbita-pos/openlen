"use client";

// «GUARDAR COMO SECRETO» DESDE EL COMPOSITOR (spec local 2026-10-11, Parte 4):
// la clave que el dueño iba a mandarle a Len va a los secretos del proyecto,
// con el nombre de los ejemplos de Supabase (que puede cambiar) y en el entorno
// que dice su forma (`sk_live_` → producción). Quien lo abrió cambia la clave
// del mensaje por ese nombre.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";

import { secretMode, suggestSecretName, type FoundSecret } from "@/lib/apps/env/secret-patterns";
import { secretNameProblem } from "@/lib/functions/secret-names";
import { postFunctionSecrets, type SaveSecretsOutcome, type SecretEnvironment, type SecretInput } from "@/lib/workspace-v2/function-secrets-request";
import { saveErrorText, SecretFieldsView } from "./secrets-card";

type Translate = (key: string, values?: Record<string, string>) => string;
type Props = { projectId: string; found: FoundSecret; onSaved: (name: string) => void; onClose: () => void };
const CLAVE = "valor";
const ENTORNOS: readonly SecretEnvironment[] = ["draft", "live"];

export function SecretDialog(props: Props) {
  const t = useTranslations("panelsChat");
  return <SecretDialogView {...props} t={(k, v) => t(k as never, v as never)} />;
}

export function SecretDialogView({
  projectId,
  found,
  onSaved,
  onClose,
  save = postFunctionSecrets,
  t,
}: Props & { save?: (projectId: string, secrets: readonly SecretInput[]) => Promise<SaveSecretsOutcome>; t: Translate }) {
  const [nombre, setNombre] = useState(() => suggestSecretName(found));
  const [values, setValues] = useState<Record<string, string>>(() => ({ [`${CLAVE}:${secretMode(found.value) === "live" ? "live" : "draft"}`]: found.value }));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    const name = nombre.trim();
    if (!name || secretNameProblem(name)) {
      setError(t("functionSecrets.invalidName"));
      return;
    }
    const entradas = ENTORNOS.map((environment) => ({ environment, name, value: (values[`${CLAVE}:${environment}`] ?? "").trim() })).filter((e) => e.value);
    if (entradas.length === 0) return onClose();
    setGuardando(true);
    setError(null);
    const r = await save(projectId, entradas);
    setGuardando(false);
    if (r.kind !== "saved") {
      setError(saveErrorText(r, t));
      return;
    }
    onSaved(name);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onKeyDown={(e) => {
        // /new escucha Escape en `document`: se marca para que no haga lo suyo.
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="secreto-titulo" className="w-full max-w-[420px] rounded-[14px] border bd bg-elev p-4 shadow-xl">
        <h2 id="secreto-titulo" className="m-0 mb-1 flex items-center gap-1.5 text-[14px] font-semibold fg">
          <KeyRound size={14} />
          {t("functionSecrets.dialogTitle")}
        </h2>
        <p className="m-0 mb-3 text-[12px] fg-muted">{t("functionSecrets.cardHint")}</p>
        <label className="mb-3 flex flex-col gap-1">
          <span className="text-[11.5px] fg-muted">{t("functionSecrets.nameField")}</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value.toUpperCase())}
            autoComplete="off"
            spellCheck={false}
            disabled={guardando}
            className="h-8 rounded-md border bd bg-app px-2 font-mono text-[12px] fg outline-none"
          />
        </label>
        <SecretFieldsView
          secret={{ name: nombre, description: "" }}
          keyName={CLAVE}
          showHeader={false}
          environments={ENTORNOS}
          values={values}
          onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
          disabled={guardando}
          t={t}
        />
        {error && (
          <p role="alert" className="m-0 mt-2 text-[11.5px] text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={guardando} className="h-8 rounded-md px-3 text-[12px] font-medium fg-faint hover:bg-hover hover:fg">
            {t("functionSecrets.cancel")}
          </button>
          <button type="button" onClick={() => void guardar()} disabled={guardando} className="h-8 rounded-md bg-[var(--accent-strong)] px-3 text-[12px] font-medium text-white disabled:opacity-50">
            {t("functionSecrets.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
