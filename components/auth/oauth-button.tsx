"use client";

import { Loader } from "lucide-react";
import { cn } from "@/lib/cn";

// ─────────────────────────────────────────────────────────────────────────────
// OAuth button with provider logos.
//
// `disabled` is set externally when the corresponding env vars (GITHUB_ID,
// GOOGLE_CLIENT_ID, ...) aren't configured — the button still renders so
// the layout matches the mockup, but with reduced opacity and a tooltip.
// ─────────────────────────────────────────────────────────────────────────────

export interface OAuthButtonProps {
  provider: "github" | "google";
  loading?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onClick?: () => void;
}

export function OAuthButton({
  provider,
  loading,
  disabled,
  disabledHint,
  onClick,
}: OAuthButtonProps) {
  const isGithub = provider === "github";
  const labelDefault = isGithub ? "Continue with GitHub" : "Continue with Google";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      title={disabled ? disabledHint : undefined}
      className={cn(
        "relative w-full inline-flex items-center justify-center gap-2.5 h-11 rounded-lg text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950",
        loading && "opacity-90 cursor-wait",
        disabled && "opacity-50 cursor-not-allowed",
        isGithub
          ? "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          : "bg-white text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:bg-zinc-900",
      )}
    >
      {loading ? (
        <Loader size={16} className="animate-spin" />
      ) : isGithub ? (
        <GithubFilled size={17} />
      ) : (
        <GoogleG size={17} />
      )}
      <span>
        {loading ? `Connecting to ${isGithub ? "GitHub" : "Google"}…` : labelDefault}
      </span>
    </button>
  );
}

function GithubFilled({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12 11.5 11.5 0 0 0 8.36 22.92c.58.1.79-.25.79-.56 0-.28-.01-1.01-.02-1.99-3.2.7-3.88-1.54-3.88-1.54-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.27 5.68.41.35.77 1.05.77 2.12 0 1.53-.01 2.77-.01 3.14 0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
