"use client";

import { useCallback, useState } from "react";
import { PanelLeftClose } from "lucide-react";
import { isBlockId, type BlockId } from "@/lib/blocks/_registry";
import { Tooltip } from "@/components/ui/tooltip";
import type { FilledBlock } from "@/lib/orchestrator/types";
import { SlotEditorBlock } from "./slot-editor-block";
import { SlotEditorContextProvider } from "./slot-editor-context";

export interface SlotEditorProps {
  /** Block payloads from the generated page — the source of truth this editor
   *  mutates locally and reports back upstream. */
  filledBlocks: FilledBlock[];
  /** The AI-generated baseline — used to compute the dirty indicator and to
   *  power the per-block "Reset" affordance. Stays constant per generation. */
  originalBlocks: FilledBlock[];
  onSlotsChange: (filledBlocks: FilledBlock[]) => void;
  onClose: () => void;
  savedLabel?: string;
  /** Scoping id for uploaded images. ImageField reads this off the editor
   *  context to bucket uploads under `/uploads/<generationId>/…`. */
  generationId: string;
}

export function SlotEditor({
  filledBlocks,
  originalBlocks,
  onSlotsChange,
  onClose,
  savedLabel,
  generationId,
}: SlotEditorProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const updateBlockSlots = useCallback(
    (blockIndex: number, newSlots: unknown) => {
      const updated = filledBlocks.map((b) =>
        b.index === blockIndex ? { ...b, slots: newSlots } : b,
      );
      onSlotsChange(updated);
    },
    [filledBlocks, onSlotsChange],
  );

  const resetBlock = useCallback(
    (blockIndex: number) => {
      const original = originalBlocks.find((b) => b.index === blockIndex);
      if (!original) return;
      updateBlockSlots(blockIndex, original.slots);
    },
    [originalBlocks, updateBlockSlots],
  );

  return (
    <SlotEditorContextProvider generationId={generationId}>
    <aside className="w-full h-full flex flex-col bg-white dark:bg-[#0a0a0a] border-r border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <header className="shrink-0 h-12 px-4 flex items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            Edit content
          </h2>
          <p className="text-[10.5px] text-zinc-400 dark:text-zinc-600 truncate">
            {savedLabel ?? "Changes preview live"}
          </p>
        </div>
        <Tooltip label="Close editor" side="bottom">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
            aria-label="Close editor"
          >
            <PanelLeftClose size={15} />
          </button>
        </Tooltip>
      </header>

      <div className="flex-1 overflow-y-auto nice-scroll divide-y divide-zinc-200 dark:divide-zinc-800">
        {filledBlocks.map((filled) => {
          if (!isBlockId(filled.blockId)) return null;
          const original = originalBlocks.find((b) => b.index === filled.index);
          const isDirty =
            original !== undefined && !slotsEqual(filled.slots, original.slots);
          return (
            <SlotEditorBlock
              key={filled.index}
              index={filled.index}
              blockId={filled.blockId as BlockId}
              slots={filled.slots}
              isOpen={openIndex === filled.index}
              isDirty={isDirty}
              onToggle={() =>
                setOpenIndex(openIndex === filled.index ? null : filled.index)
              }
              onChange={(newSlots) => updateBlockSlots(filled.index, newSlots)}
              onReset={() => resetBlock(filled.index)}
            />
          );
        })}
      </div>
    </aside>
    </SlotEditorContextProvider>
  );
}

/** Stable-ish equality for slot payloads. JSON.stringify is good enough at
 *  this scale (slot trees are ~1–2KB) and avoids a deep-equal dep. Order
 *  differences would cause false positives but we always build new slot
 *  objects from the same Zod schema, so key order stays stable. */
function slotsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
