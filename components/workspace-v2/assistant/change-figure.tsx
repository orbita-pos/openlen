"use client";

// «CAMBIAR FIGURA» (spec local 2026-11-10-figuras-del-asistente, §5.6): in her place, the same creator that made her,
// now only for her figure. Like her name, a published page wears the figure it was baked with until its next publish
// (§5.7): it says so.
import { Smile } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { FigureLook } from "@/lib/figure/look";

import { useToast } from "../toast";
import { AssistantCreatorDialog } from "./creator-dialog";
import { HER_ROW } from "./her-sheet";

export function ChangeFigure({
  assistant,
  onPage,
  onChanged,
  onOpenChange,
}: {
  assistant: { id: string; name: string; look: FigureLook; projectId: string };
  /** Her bubble is on a published page: a publish shows the new figure there. */
  onPage: boolean;
  onChanged: (look: FigureLook) => void;
  /** The creator is open: its figure is the live one, so her place pauses its own. */
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("panelsChat");
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);
  const toast = useToast();
  const show = (next: boolean) => (setOpen(next), onOpenChange?.(next));
  return (
    <>
      <button type="button" data-change-figure="" onClick={() => show(true)} className={HER_ROW}>
        <Smile size={15} strokeWidth={1.8} className="shrink-0 fg-muted" aria-hidden="true" />
        {t("ownAssistant.place.changeFigure")}
      </button>
      {changed && onPage && (
        <p data-figure-publish="" className="px-2.5 pb-1 text-[11.5px] leading-snug fg-faint">
          {t("ownAssistant.place.figurePublish")}
        </p>
      )}
      {open && (
        <AssistantCreatorDialog
          open
          projectId={assistant.projectId}
          onClose={() => show(false)}
          onCreated={() => {}}
          editing={{ id: assistant.id, name: assistant.name, look: assistant.look }}
          onSaved={(look) => {
            setChanged(true);
            onChanged(look);
            show(false);
            // The creator closing alone does not say it was kept.
            toast.success(t("ownAssistant.place.figureSaved"));
          }}
        />
      )}
    </>
  );
}
