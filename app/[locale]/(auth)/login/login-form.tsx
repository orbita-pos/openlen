"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { signIn } from "next-auth/react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/auth/card";
import { OAuthButton } from "@/components/auth/oauth-button";
import {
  AuthButton,
  AuthDivider,
  AuthInput,
  ErrorBanner,
} from "@/components/auth/primitives";

export function LoginForm({
  next,
  initialError,
  oauth,
}: {
  next: string;
  initialError: string | null;
  oauth: { google: boolean };
}) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | null>(null);
  const [error, setError] = useState<string | null>(initialError);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError(t("login.errors.invalidCredentials"));
        setLoading(false);
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError(t("common.errors.genericRetry"));
      setLoading(false);
    }
  };

  const onOAuth = async (provider: "google") => {
    setOauthLoading(provider);
    await signIn(provider, { callbackUrl: `/${locale}${next}` });
  };

  return (
    <Card title={t("login.title")} subtitle={t("login.subtitle")}>
      {error && (
        <ErrorBanner>
          {error}{" "}
          <Link
            href="/forgot"
            className="font-semibold underline underline-offset-2 hover:no-underline"
          >
            {t("login.resetLink")}
          </Link>
        </ErrorBanner>
      )}

      <div className="space-y-2.5">
        <OAuthButton
          provider="google"
          loading={oauthLoading === "google"}
          disabled={!oauth.google}
          disabledHint="Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET to enable"
          onClick={() => onOAuth("google")}
        />
      </div>

      <AuthDivider>{t("login.divider")}</AuthDivider>

      <form onSubmit={onSubmit} className="space-y-4">
        <AuthInput
          id="email"
          label={t("fields.email")}
          type="email"
          autoComplete="email"
          placeholder={t("fields.emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label
              htmlFor="password"
              className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100"
            >
              {t("fields.password")}
            </label>
            <Link
              href="/forgot"
              className="text-[12px] font-medium text-coral-700 dark:text-coral-400 hover:underline"
            >
              {t("login.forgotPassword")}
            </Link>
          </div>
          <AuthInput
            id="password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? t("fields.hidePassword") : t("fields.showPassword")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            }
          />
        </div>

        <AuthButton
          type="submit"
          size="lg"
          loading={loading}
          className="shimmer w-full"
        >
          {loading ? t("login.submitting") : (
            <>
              {t("login.submit")} <ArrowRight size={15} />
            </>
          )}
        </AuthButton>
      </form>

      <div className="pt-2 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
        {t("login.noAccount")}{" "}
        <Link
          href="/register"
          className="font-medium text-coral-700 dark:text-coral-400 hover:underline"
        >
          {t("login.createOne")}
        </Link>
      </div>
    </Card>
  );
}
