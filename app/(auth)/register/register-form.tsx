"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/auth/card";
import { OAuthButton } from "@/components/auth/oauth-button";
import {
  AuthButton,
  AuthCheckbox,
  AuthDivider,
  AuthInput,
  ErrorBanner,
  StrengthBar,
} from "@/components/auth/primitives";

// Reject offsite ?next= so a crafted URL can't bounce the user to another
// domain after sign-up.
function sanitizeNext(raw: string | null): string {
  if (!raw) return "/new-v2";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/new-v2";
  return raw;
}

export function RegisterForm({
  oauth,
}: {
  oauth: { github: boolean; google: boolean };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = sanitizeNext(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"github" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setExists(false);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });
      if (res.status === 409) {
        setExists(true);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Request failed (${res.status})`);
        setLoading(false);
        return;
      }
      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (signInResult?.error) {
        setError(
          "Account created but sign-in failed. Try signing in manually.",
        );
        setLoading(false);
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  };

  const onOAuth = async (provider: "github" | "google") => {
    setOauthLoading(provider);
    await signIn(provider, { callbackUrl: nextPath });
  };

  return (
    <Card
      title="Create your account"
      subtitle="Generate your first landing page in 60 seconds."
    >
      {exists && (
        <ErrorBanner>
          An account with this email already exists.{" "}
          <Link
            href={`/login?next=${encodeURIComponent(nextPath)}`}
            className="font-semibold underline underline-offset-2 hover:no-underline"
          >
            Sign in instead?
          </Link>
        </ErrorBanner>
      )}
      {error && !exists && <ErrorBanner>{error}</ErrorBanner>}

      <div className="space-y-2.5">
        <OAuthButton
          provider="github"
          loading={oauthLoading === "github"}
          disabled={!oauth.github}
          disabledHint="Set GITHUB_ID + GITHUB_SECRET in .env.local to enable"
          onClick={() => onOAuth("github")}
        />
        <OAuthButton
          provider="google"
          loading={oauthLoading === "google"}
          disabled={!oauth.google}
          disabledHint="Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET to enable"
          onClick={() => onOAuth("google")}
        />
      </div>

      <AuthDivider>or sign up with email</AuthDivider>

      <form onSubmit={onSubmit} className="space-y-4">
        <AuthInput
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@yourcompany.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <div>
          <AuthInput
            id="password"
            label="Password"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            }
          />
          <StrengthBar pw={password} />
        </div>

        <AuthInput
          id="name"
          label={
            <>
              Your name{" "}
              <span className="text-zinc-400 font-normal">(optional)</span>
            </>
          }
          autoComplete="name"
          placeholder="Jesus B."
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <AuthCheckbox
          checked={agreed}
          onChange={setAgreed}
          label={
            <>
              I agree to the{" "}
              <a
                href="#"
                className="font-medium text-zinc-900 dark:text-zinc-100 underline underline-offset-2 hover:no-underline"
              >
                Terms
              </a>{" "}
              and{" "}
              <a
                href="#"
                className="font-medium text-zinc-900 dark:text-zinc-100 underline underline-offset-2 hover:no-underline"
              >
                Privacy Policy
              </a>
              .{" "}
              <span className="text-zinc-400 dark:text-zinc-600 italic">
                AGPL applies to self-hosted use.
              </span>
            </>
          }
        />

        <AuthButton
          type="submit"
          size="lg"
          loading={loading}
          disabled={!agreed || password.length < 8}
          className="shimmer w-full"
        >
          {loading ? "Creating account…" : (
            <>
              Create account <ArrowRight size={15} />
            </>
          )}
        </AuthButton>
      </form>

      <div className="pt-2 text-center text-[13px] text-zinc-500 dark:text-zinc-500">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-coral-700 dark:text-coral-400 hover:underline"
        >
          Sign in →
        </Link>
      </div>
    </Card>
  );
}
