// Global route-transition fallback. Per-route loading.tsx files (under
// /projects, /new, /login, etc.) take precedence — this only renders for
// routes that don't define their own, and during the initial server-component
// fetch on navigation.
//
// Kept intentionally minimal: a sticky 2px coral progress bar at the top
// and a centered pulsing brand mark. No skeletons of unknown page content —
// that would mislead the user about what's coming.

import { OpenLenMark } from "@/components/openlen-logo";

export default function GlobalLoading() {
  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      <div
        className="absolute top-0 left-0 h-[2px] bg-coral-500 animate-[openlenLoadingBar_1.4s_ease-in-out_infinite]"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, #FF5A36 50%, transparent 100%)",
        }}
        aria-hidden
      />
      <div className="flex h-full items-center justify-center">
        <div className="relative inline-flex h-10 w-10 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-coral-500 opacity-20 animate-ping" />
          <OpenLenMark className="relative h-10 w-10" />
        </div>
      </div>
      <style>{`
        @keyframes openlenLoadingBar {
          0% { left: -40%; width: 40%; }
          50% { left: 30%; width: 50%; }
          100% { left: 100%; width: 40%; }
        }
      `}</style>
    </div>
  );
}
