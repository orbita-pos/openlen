import { AuthShell } from "@/components/auth/auth-shell";

// Shared skeleton for /login /register /forgot /reset Suspense fallbacks.
// Matches the Card shape so the eventual content lands in roughly the same
// space without a layout shift.
export function AuthLoading() {
  return (
    <AuthShell>
      <div className="lift">
        <div className="rounded-2xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 card-glow p-7 sm:p-8">
          <div className="h-8 w-2/3 rounded-md skeleton" />
          <div className="mt-3 h-4 w-3/4 rounded-md skeleton-soft" />
          <div className="mt-6 space-y-3">
            <div className="h-11 rounded-lg skeleton" />
            <div className="h-11 rounded-lg skeleton" />
            <div className="my-2 flex items-center gap-3">
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-24 rounded skeleton-soft" />
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <div className="space-y-1.5">
              <div className="h-3 w-12 rounded skeleton-soft" />
              <div className="h-10 rounded-lg skeleton" />
            </div>
            <div className="space-y-1.5">
              <div className="h-3 w-20 rounded skeleton-soft" />
              <div className="h-10 rounded-lg skeleton" />
            </div>
            <div className="h-11 rounded-lg skeleton" />
          </div>
          <div className="mt-6 h-3 w-1/2 mx-auto rounded skeleton-soft" />
        </div>
      </div>
    </AuthShell>
  );
}
