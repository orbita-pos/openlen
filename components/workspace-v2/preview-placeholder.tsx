// Empty placeholder shown in the main preview area while the workspace is
// in a non-editing entry mode (user picked AI/Template/Paste but hasn't
// committed to a project yet). The actual entry surface lives in the
// sidebar — this placeholder just keeps the right pane visually quiet and
// points the user toward the action.

"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, FileText, PaletteIcon, Wand } from "./icons";

interface PreviewPlaceholderProps {
  mode: "ai" | "template" | "paste";
}

const SPEC: Record<
  PreviewPlaceholderProps["mode"],
  {
    Icon: React.ComponentType<{ size?: number; className?: string }>;
  }
> = {
  ai: { Icon: Wand },
  template: { Icon: PaletteIcon },
  paste: { Icon: FileText },
};

export function PreviewPlaceholder({ mode }: PreviewPlaceholderProps) {
  const t = useTranslations("wsChrome");
  const { Icon } = SPEC[mode];
  const title = t(`placeholder.${mode}.title`);
  const hint = t(`placeholder.${mode}.hint`);
  return (
    <section className="relative flex flex-col flex-1 min-w-0 bg-preview-a">
      <div className="flex-1 min-h-0 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-[color:var(--border)] bg-elev text-accent">
            <Icon size={18} />
          </div>
          <h3 className="text-[15px] font-semibold fg tracking-tight">
            {title}
          </h3>
          <p className="mt-2 text-[12.5px] fg-muted leading-relaxed">{hint}</p>
          <div className="mt-5 inline-flex items-center gap-1.5 text-[11px] fg-faint">
            <ChevronLeft size={12} />
            {t("placeholder.sidebar")}
          </div>
        </div>
      </div>
    </section>
  );
}
