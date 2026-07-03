import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";

// Shared top bar for the public community surfaces (/explore, /@handle) — same
// shape as the inbox header: a back arrow to the workspace, a coral icon chip,
// and the page title. Purely presentational (works in server components).
export default function BackNav({
  title,
  icon,
  backHref = "/new",
  backLabel = "Back to workspace",
}: {
  title: string;
  icon: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0a0b]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-5 py-3">
        <Link
          href={backHref}
          aria-label={backLabel}
          title={backLabel}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft size={18} />
        </Link>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-coral-500/10 text-coral-500">
          {icon}
        </span>
        <h1 className="truncate text-[15px] font-semibold leading-tight text-neutral-100">{title}</h1>
      </div>
    </header>
  );
}
