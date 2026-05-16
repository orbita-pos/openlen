"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Card } from "@/components/auth/card";
import {
  AuthButton,
  AuthInput,
  ErrorBanner,
} from "@/components/auth/primitives";

export function ForgotForm() {
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
        setError(data.error ?? `Request failed (${res.status})`);
        setLoading(false);
        return;
      }
      setSentTo(target);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  };

  if (sentTo) {
    return (
      <Card
        title="Check your inbox"
        subtitle="We sent you a link to reset your password."
        kicker="Email sent"
      >
        <div className="-mt-1 flex flex-col items-center text-center py-2">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-coral-50 dark:bg-coral-500/10 ring-1 ring-coral-200 dark:ring-coral-500/30 text-coral-600 dark:text-coral-400 mb-4">
            <Mail size={22} />
          </span>
          <p className="text-[14px] text-zinc-700 dark:text-zinc-300 leading-relaxed">
            We sent a link to{" "}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {sentTo}
            </span>
            .
            <br />
            It expires in <span className="font-medium">1 hour</span>.
          </p>
          <p className="mt-3 text-[12px] text-zinc-400 dark:text-zinc-600">
            Don&apos;t see it? Check spam, or{" "}
            <button
              type="button"
              onClick={() => send(sentTo)}
              disabled={loading}
              className="font-medium text-coral-700 dark:text-coral-400 hover:underline disabled:opacity-60"
            >
              {loading ? "sending…" : "send again"}
            </button>
            .
          </p>
        </div>

        <div className="border-t border-zinc-100 dark:border-zinc-900 pt-4 text-center text-[13px] text-zinc-500 dark:text-zinc-500">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 font-medium text-coral-700 dark:text-coral-400 hover:underline"
          >
            <ArrowLeft size={13} /> Back to sign in
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Reset your password"
      subtitle="We'll send you a reset link. Check your email."
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
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@yourcompany.com"
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
          {loading ? "Sending link…" : (
            <>
              Send reset link <Mail size={15} />
            </>
          )}
        </AuthButton>
      </form>
      <div className="pt-2 text-center text-[13px] text-zinc-500 dark:text-zinc-500">
        Remembered it?{" "}
        <Link
          href="/login"
          className="font-medium text-coral-700 dark:text-coral-400 hover:underline"
        >
          Back to sign in →
        </Link>
      </div>
    </Card>
  );
}
