"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowLeft, Mail } from "lucide-react";
import { Card } from "@/components/auth/card";
import {
  AuthButton,
  AuthInput,
  ErrorBanner,
} from "@/components/auth/primitives";

export function ForgotForm() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (target: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? t("common.errors.requestFailed", { status: res.status }));
        setLoading(false);
        return;
      }
      setSentTo(target);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.errors.generic"));
      setLoading(false);
    }
  };

  if (sentTo) {
    return (
      <Card
        title={t("forgot.sent.title")}
        subtitle={t("forgot.sent.subtitle")}
        kicker={t("forgot.sent.kicker")}
      >
        <div role="status" className="-mt-1 flex flex-col items-center text-center py-2">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-coral-50 dark:bg-coral-500/10 ring-1 ring-coral-200 dark:ring-coral-500/30 text-coral-600 dark:text-coral-400 mb-4">
            <Mail size={22} />
          </span>
          <p className="text-[14px] text-zinc-700 dark:text-zinc-300 leading-relaxed">
            {t.rich("forgot.sent.sentTo", {
              email: sentTo,
              strong: (chunks) => (
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {chunks}
                </span>
              ),
            })}
            <br />
            {t.rich("forgot.sent.expires", {
              strong: (chunks) => <span className="font-medium">{chunks}</span>,
            })}
          </p>
          <p className="mt-3 text-[12px] text-zinc-500 dark:text-zinc-400">
            {t("forgot.sent.notSeeing")}{" "}
            <button
              type="button"
              onClick={() => send(sentTo)}
              disabled={loading}
              className="font-medium text-coral-700 dark:text-coral-400 hover:underline disabled:opacity-60"
            >
              {loading ? t("forgot.sent.sending") : t("forgot.sent.sendAgain")}
            </button>
            .
          </p>
        </div>

        <div className="border-t border-zinc-100 dark:border-zinc-900 pt-4 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 font-medium text-coral-700 dark:text-coral-400 hover:underline"
          >
            <ArrowLeft size={13} /> {t("forgot.backToSignIn")}
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={t("forgot.title")}
      subtitle={t("forgot.subtitle")}
    >
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(email);
        }}
        className="space-y-4"
      >
        <AuthInput
          id="email"
          label={t("fields.email")}
          type="email"
          autoComplete="email"
          autoFocus
          placeholder={t("fields.emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <AuthButton
          type="submit"
          size="lg"
          loading={loading}
          className="shimmer w-full"
        >
          {loading ? t("forgot.submitting") : (
            <>
              {t("forgot.submit")} <Mail size={15} />
            </>
          )}
        </AuthButton>
      </form>
      <div className="pt-2 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
        {t("forgot.remembered")}{" "}
        <Link
          href="/login"
          className="font-medium text-coral-700 dark:text-coral-400 hover:underline"
        >
          {t("forgot.backToSignInArrow")}
        </Link>
      </div>
    </Card>
  );
}
