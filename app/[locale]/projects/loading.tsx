// Shown while listProjects() resolves on the server — same layout as the
// real page (header + toolbar + 6 skeleton cards) so nothing shifts when the
// real data lands.

export default function ProjectsLoading() {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-[#0a0a0a]">
      {/* Header placeholder */}
      <div className="sticky top-0 z-30 h-14 px-4 sm:px-6 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-[#0a0a0a]/85 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 rounded-md bg-coral-500" />
          <div className="hidden sm:block h-3 w-20 rounded skeleton-soft" />
          <div className="hidden md:block h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
          <div className="hidden md:block h-3 w-16 rounded skeleton" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-24 rounded-md skeleton" />
          <div className="h-8 w-8 rounded-md skeleton-soft" />
          <div className="h-8 w-12 rounded-full skeleton-soft" />
        </div>
      </div>

      {/* Toolbar placeholder */}
      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pt-10 pb-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="h-10 w-48 rounded-md skeleton" />
            <div className="mt-3 h-4 w-32 rounded skeleton-soft" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="h-9 w-56 rounded-lg skeleton" />
            <div className="h-9 w-24 rounded-lg skeleton-soft" />
            <div className="h-9 w-28 rounded-lg skeleton-soft" />
            <div className="h-9 w-20 rounded-lg skeleton-soft" />
          </div>
        </div>
      </div>

      {/* Usage strip placeholder */}
      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pb-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] px-3.5 py-3"
            >
              <div className="h-9 w-9 rounded-lg skeleton" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 w-16 rounded skeleton-soft" />
                <div className="h-3.5 w-32 rounded skeleton" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Card grid placeholder */}
      <main className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-2 pb-32">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <article
              key={i}
              className="rounded-xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden"
            >
              <div className="aspect-[16/10] skeleton" />
              <div className="px-3.5 py-3 space-y-2">
                <div className="h-4 w-2/3 rounded skeleton" />
                <div className="h-3 w-1/3 rounded skeleton-soft" />
                <div className="flex gap-1.5 pt-1">
                  <div className="h-4 w-12 rounded skeleton-soft" />
                  <div className="h-4 w-14 rounded skeleton-soft" />
                </div>
                <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-900 pt-2.5">
                  <div className="h-3 w-24 rounded skeleton-soft" />
                  <div className="h-3 w-4 rounded skeleton-soft" />
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
