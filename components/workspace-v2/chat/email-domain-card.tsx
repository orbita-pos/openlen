"use client";

// THE EMAIL DOMAIN'S CARD (spec local 2026-10-22-email-integration, 6.8): what Len
// shows with `connect_email_domain`. The owner types the domain (the project's
// own proposed) and connects it through the Correos tab's own route; up to the
// turn goes only the address it will send from. The DNS lines are in the tab.

import { useEffect, useState } from "react";
import { Check, Loader, Mail, X } from "lucide-react";

import { EMAIL_DOMAIN_QUESTION_ID, type QuestionAnswer } from "@/lib/agent/ask-user-question";

type Translate = (key: string, values?: Record<string, string>) => string;
const CONNECT_ERRORS: ReadonlySet<string> = new Set(["free_plan", "invalid_domain", "host_taken", "provider_error"]);

export function EmailDomainCardView({
  projectId,
  answer,
  cancelled,
  onAnswer,
  t,
}: {
  projectId: string | null;
  answer: string | null;
  cancelled?: boolean;
  onAnswer?: (answers: QuestionAnswer[]) => void;
  t: Translate;
}) {
  const [domain, setDomain] = useState<string | null>(null);
  const [suggested, setSuggested] = useState("");
  const [showAsRoot, setShowAsRoot] = useState(false);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "connecting" } | { kind: "error"; text: string } | { kind: "sent" }>({ kind: "idle" });
  const open = answer === null && !cancelled;

  useEffect(() => {
    if (!projectId || !open) return;
    let alive = true;
    void fetch(`/api/projects/${projectId}/email`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { suggestedDomain?: unknown } | null) => {
        if (alive && typeof p?.suggestedDomain === "string") setSuggested(p.suggestedDomain);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, open]);

  if (!open) {
    return (
      <div className="nc-up flex min-w-0 items-center gap-2 rounded-[10px] border bd bg-elev px-2.5 py-1.5 text-[12px] fg-muted">
        {cancelled ? <X size={13} className="shrink-0 fg-faint" /> : <Check size={13} className="nc-ok shrink-0" />}
        <span className="min-w-0 truncate">{cancelled ? t("newChat.question.cancelled") : answer ? t("emailDomain.connected", { host: answer }) : t("emailDomain.skipped")}</span>
      </div>
    );
  }

  const field = domain ?? suggested;
  const answerable = Boolean(onAnswer && projectId) && state.kind !== "sent";
  const reply = (selected: string[]) => {
    setState({ kind: "sent" });
    onAnswer?.([{ id: EMAIL_DOMAIN_QUESTION_ID, selected }]);
  };
  const connect = async () => {
    if (!answerable || !projectId || !field.trim()) return;
    setState({ kind: "connecting" });
    try {
      const res = await fetch(`/api/projects/${projectId}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "connect", domain: field.trim(), showAsRoot }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; domain?: { sendingHost?: string } | null };
      if (!res.ok || !body.domain?.sendingHost) {
        setState({ kind: "error", text: t(body.error && CONNECT_ERRORS.has(body.error) ? `emailDomain.errors.${body.error}` : "emailDomain.errors.generic") });
        return;
      }
      reply([body.domain.sendingHost]);
    } catch {
      setState({ kind: "error", text: t("emailDomain.errors.generic") });
    }
  };

  return (
    <div className="nc-ask px-3.5 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--nc-accent-text)]">
        <Mail size={13} />
        {t("emailDomain.cardLabel")}
      </div>
      <p className="m-0 mb-2 text-[11.5px] fg-muted">{t("emailDomain.cardHint")}</p>
      <input
        type="text"
        value={field}
        onChange={(e) => setDomain(e.target.value)}
        placeholder={t("emailDomain.placeholder")}
        autoComplete="off"
        spellCheck={false}
        disabled={!answerable || state.kind === "connecting"}
        className="h-8 w-full rounded-md border bd bg-transparent px-2.5 font-mono text-[12.5px] fg outline-none focus:border-[var(--accent-strong)]"
      />
      <label className="mt-1.5 flex items-center gap-2 text-[11.5px] fg-muted">
        <input type="checkbox" checked={showAsRoot} onChange={(e) => setShowAsRoot(e.target.checked)} disabled={!answerable} />
        {t("emailDomain.showAsRoot", { domain: field.trim() || t("emailDomain.placeholder") })}
      </label>
      {state.kind === "error" ? (
        <p role="alert" className="m-0 mt-2 text-[11.5px] text-red-600 dark:text-red-400">
          {state.text}
        </p>
      ) : null}
      {answerable ? (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void connect()}
            disabled={state.kind === "connecting" || !field.trim()}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white disabled:opacity-50"
          >
            {state.kind === "connecting" ? (
              <>
                <Loader size={12} className="animate-spin" />
                {t("emailDomain.connecting")}
              </>
            ) : (
              t("emailDomain.connect")
            )}
          </button>
          <button type="button" onClick={() => reply([])} disabled={state.kind === "connecting"} className="h-7 rounded-md px-2.5 text-[11.5px] font-medium fg-faint hover:bg-hover hover:fg">
            {t("emailDomain.skip")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
