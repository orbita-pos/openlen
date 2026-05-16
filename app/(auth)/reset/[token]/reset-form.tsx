"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/auth/card";
import {
  AuthButton,
  AuthInput,
  ErrorBanner,
  MatchIndicator,
  Requirement,
  StrengthBar,
} from "@/components/auth/primitives";

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const reqs = {
    len: password.length >= 8,
    num: /\d/.test(password),
    sym: /[^A-Za-z0-9]/.test(password),
  };
  const match = password.length > 0 && password === password2;
  const mismatch = password2.length > 0 && password !== password2;
  const canSubmit = reqs.len && reqs.num && reqs.sym && match && email.length > 0;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setExpired(false);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.status === 400) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === "invalid") {
          setExpired(true);
          setLoading(false);
          return;
        }
        setError(data.error ?? "Could not reset password.");
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
        setError("Password updated. Please sign in.");
        setLoading(false);
        router.push("/login");
        return;
      }
      router.push("/new");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  };

  return (
    <Card
      title="Set a new password"
      subtitle="Make it strong. We'll sign you in after."
    >
      {expired && (
        <ErrorBanner>
          This link expired.{" "}
          <Link
            href="/forgot"
            className="font-semibold underline underline-offset-2 hover:no-underline"
          >
            Request a new one.
          </Link>
        </ErrorBanner>
      )}
      {error && !expired && <ErrorBanner>{error}</ErrorBanner>}
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
            id="new-pw"
            label="New password"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
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
          id="confirm-pw"
          label="Confirm password"
          type={showPw ? "text" : "password"}
          autoComplete="new-password"
          placeholder="Repeat password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          required
          error={mismatch}
          rightSlot={<MatchIndicator match={match} mismatch={mismatch} />}
        />
        {mismatch && (
          <p className="-mt-2 text-[11.5px] text-red-600 dark:text-red-400">
            Passwords don&apos;t match.
          </p>
        )}

        <ul className="mt-1 grid grid-cols-1 gap-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 ring-1 ring-zinc-100 dark:ring-zinc-900 p-3">
          <Requirement ok={reqs.len}>At least 8 characters</Requirement>
          <Requirement ok={reqs.num}>Contains a number</Requirement>
          <Requirement ok={reqs.sym}>Contains a symbol</Requirement>
        </ul>

        <AuthButton
          type="submit"
          size="lg"
          loading={loading}
          disabled={!canSubmit}
          className="shimmer w-full"
        >
          {loading ? "Updating…" : (
            <>
              Update password and sign in <ArrowRight size={15} />
            </>
          )}
        </AuthButton>
      </form>
      <div className="pt-1 text-center text-[13px] text-zinc-500 dark:text-zinc-500">
        <Link
          href="/login"
          className="font-medium hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>
    </Card>
  );
}
