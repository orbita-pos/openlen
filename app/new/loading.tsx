// Brief flash shown while the /new route bundle finishes loading. The
// workspace itself is mostly client-side state, so this only appears for
// the very first navigation. Matches the two-pane layout to avoid a shift.

export default function NewLoading() {
  return (
    <div className="md:h-screen flex flex-col min-h-screen md:min-h-0">
      {/* Header placeholder */}
      <div className="sticky top-0 z-30 h-14 px-4 sm:px-6 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-[#0a0a0a]/85 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 rounded-md bg-coral-500" />
          <div className="hidden sm:block h-3 w-20 rounded skeleton-soft" />
          <div className="hidden md:block h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
          <div className="hidden md:block h-3 w-16 rounded skeleton-soft" />
          <div className="hidden md:block h-3 w-3 rounded skeleton-soft opacity-50" />
          <div className="h-4 w-28 rounded skeleton" />
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:block h-7 w-16 rounded-md skeleton-soft" />
          <div className="h-8 w-20 rounded-md skeleton" />
          <div className="hidden sm:block h-5 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />
          <div className="h-8 w-8 rounded-md skeleton-soft" />
          <div className="h-8 w-12 rounded-full skeleton-soft" />
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(340px,40%)_minmax(0,1fr)]">
        {/* Brief panel placeholder */}
        <aside className="bg-white dark:bg-[#0a0a0a] border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-5 w-20 rounded-full skeleton" />
            <div className="h-7 w-7 rounded-md skeleton-soft" />
          </div>
          <div className="space-y-2 pt-6">
            <div className="h-6 w-3/4 rounded skeleton" />
            <div className="h-4 w-full rounded skeleton-soft" />
            <div className="h-4 w-5/6 rounded skeleton-soft" />
          </div>
          <div className="h-40 rounded-2xl skeleton mt-4" />
          <div className="flex gap-2">
            <div className="h-6 w-12 rounded-md skeleton-soft" />
            <div className="h-6 w-16 rounded-md skeleton-soft" />
            <div className="h-6 w-14 rounded-md skeleton-soft" />
          </div>
          <div className="pt-4 border-t border-zinc-100 dark:border-zinc-900">
            <div className="flex items-center justify-between">
              <div className="h-3 w-40 rounded skeleton-soft" />
              <div className="h-3 w-12 rounded skeleton-soft" />
            </div>
          </div>
        </aside>

        {/* Preview placeholder */}
        <main className="bg-zinc-100 dark:bg-zinc-950 flex flex-col">
          <div className="h-12 border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-[#0a0a0a]/70 backdrop-blur px-4 flex items-center gap-3">
            <div className="h-7 w-44 rounded-md skeleton-soft" />
            <div className="flex-1" />
            <div className="h-7 w-7 rounded-md skeleton-soft" />
            <div className="h-7 w-7 rounded-md skeleton-soft" />
          </div>
          <div className="flex-1 p-8 dotted">
            <div className="mx-auto max-w-3xl rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] overflow-hidden">
              <div className="h-9 px-3 flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                <span className="h-2.5 w-2.5 rounded-full bg-red-300/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/70" />
              </div>
              <div className="h-[480px] flex flex-col items-center justify-center gap-4">
                <div className="h-8 w-1/2 rounded skeleton" />
                <div className="h-4 w-1/3 rounded skeleton-soft" />
                <div className="mt-6 h-9 w-32 rounded-md skeleton" />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
