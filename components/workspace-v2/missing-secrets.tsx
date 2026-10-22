"use client";

// LOS SECRETOS QUE LE FALTAN A LA PUBLICADA (spec local 2026-10-11, Parte 4):
// las funciones leen un `Deno.env.get("…")` que no tiene valor en producción.
// Se rellenan aquí —a la ruta de secretos, sólo producción: el dueño o un
// editor, nunca Len— y se publica; o «Publicar igual». Lo usan la tarjeta de
// publicar de Len y el modal de publicar.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";

import { postFunctionSecrets, type SaveSecretsOutcome, type SecretInput } from "@/lib/workspace-v2/function-secrets-request";
import { saveErrorText, SecretFieldsView, secretInputs } from "./chat/secrets-card";

type Translate = (key: string, values?: Record<string, string>) => string;
type Props = {
  projectId: string;
  missing: readonly string[];
  busy: boolean;
  /** Guardados: publicar otra vez (ya no faltan). */
  onSavedPublish: () => void;
  onPublishAnyway: () => void;
  onCancel?: () => void;
};

export function MissingSecrets(props: Props) {
  const t = useTranslations("panelsChat");
  return <MissingSecretsView {...props} t={(k, v) => t(k as never, v as never)} />;
}

export function MissingSecretsView({
  projectId,
  missing,
  busy,
  onSavedPublish,
  onPublishAnyway,
  onCancel,
  save = postFunctionSecrets,
  t,
}: Props & { save?: (projectId: string, secrets: readonly SecretInput[]) => Promise<SaveSecretsOutcome>; t: Translate }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const secretos = missing.map((name) => ({ name, description: "" }));
  const entradas = secretInputs(secretos, ["live"], values);

  const guardarYPublicar = async () => {
    if (entradas.length === 0) return;
    setGuardando(true);
    setError(null);
    const r = await save(projectId, entradas);
    setGuardando(false);
    if (r.kind !== "saved") {
      setError(saveErrorText(r, t));
      return;
    }
    setValues({});
    onSavedPublish();
  };

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-2 text-[11.5px] dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200">
        <KeyRound size={12} />
        {t("functionSecrets.missingTitle")}
      </div>
      {/* Stripe (spec local 2026-10-21-stripe-integration, §6.4): with no function reading it, the key is what
          copies the Stripe objects to live mode, and without it the published page keeps the test ones. */}
      <p className="m-0 mt-0.5 fg-muted">
        {t(missing.length === 1 && missing[0] === "STRIPE_SECRET_KEY" ? "functionSecrets.stripe.missingHint" : "functionSecrets.missingHint")}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {secretos.map((s) => (
          <SecretFieldsView key={s.name} secret={s} environments={["live"]} values={values} onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))} disabled={busy || guardando} t={t} />
        ))}
      </div>
      {error && (
        <p role="alert" className="m-0 mt-2 text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void guardarYPublicar()}
          disabled={busy || guardando || entradas.length === 0}
          className="inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white disabled:opacity-50"
        >
          {t("functionSecrets.saveAndPublish")}
        </button>
        <button type="button" onClick={onPublishAnyway} disabled={busy || guardando} className="h-7 rounded-md px-2.5 text-[11.5px] font-medium fg hover:bg-hover">
          {t("functionSecrets.publishAnyway")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy || guardando} className="h-7 rounded-md px-2.5 text-[11.5px] font-medium fg-faint hover:bg-hover hover:fg">
            {t("functionSecrets.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
