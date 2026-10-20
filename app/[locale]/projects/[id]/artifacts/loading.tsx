import "@/app/[locale]/new/tokens.css";

// Shown while the history page checks access and reads the project. Without
// it this route inherited app/[locale]/projects/loading.tsx — the project
// cards — and the deliverables history flashed in as a different page. Same
// layout as ArtifactLibrary (header, title, filters, rows), so nothing shifts.
export default function ArtifactHistoryLoading() {
  return (
    <div data-loading="artifact-history" aria-busy="true" className="workspace-v2 flex h-dvh min-h-0 flex-col">
      <header className="shrink-0 border-b bd bg-elev">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="h-3 w-40 rounded skeleton-soft" />
          <div className="h-3 w-16 rounded skeleton-soft" />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
          {/* The boxes keep the real line heights: the title's, then the
              subtitle's, which takes two lines on a phone. */}
          <div className="flex h-[38px] items-center"><div className="h-8 w-56 rounded-md skeleton" /></div>
          <div className="mt-2 flex h-[42px] flex-col justify-around sm:h-[21px] sm:justify-center">
            <div className="h-3.5 w-80 max-w-full rounded skeleton-soft" />
            <div className="h-3.5 w-40 rounded skeleton-soft sm:hidden" />
          </div>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <div className="h-10 flex-1 rounded-lg skeleton-soft" />
            <div className="flex gap-3">
              <div className="h-10 flex-1 rounded-lg skeleton-soft sm:w-44" />
              <div className="h-10 flex-1 rounded-lg skeleton-soft sm:w-44" />
            </div>
          </div>
          <div className="mt-4 border-b bd pb-4">
            <div className="h-8 w-64 max-w-full rounded-md skeleton-soft" />
          </div>
          <div className="mb-3 mt-8 flex h-[18px] items-center"><div className="h-3 w-24 rounded skeleton-soft" /></div>
          <ul className="overflow-hidden rounded-xl border bd bg-elev">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-b last:border-b-0 bd px-3 py-4 sm:grid-cols-[40px_minmax(0,1fr)_120px_130px_130px] sm:px-4">
                <div className="h-9 w-9 rounded-lg skeleton" />
                <div className="min-w-0">
                  <div className="flex h-[18px] items-center"><div className="h-3.5 w-48 max-w-full rounded skeleton" /></div>
                  <div className="mt-1 flex h-4 items-center"><div className="h-3 w-20 rounded skeleton-soft" /></div>
                  {/* On a phone the status sits under the title. */}
                  <div className="mt-2 h-[25px] w-20 rounded-full skeleton-soft sm:hidden" />
                </div>
                <div className="hidden h-6 w-20 rounded-full skeleton-soft sm:block" />
                <div className="hidden h-3 w-16 rounded skeleton-soft sm:block" />
                <div />
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
