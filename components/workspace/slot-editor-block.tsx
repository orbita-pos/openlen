"use client";

import { useMemo } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { BLOCK_REGISTRY, type BlockId } from "@/lib/blocks/_registry";
import { zodToFormMetadata } from "@/lib/zod-to-form";
import { cn } from "@/lib/cn";
import { SlotField } from "./slot-fields/slot-field";

export interface SlotEditorBlockProps {
  index: number;
  blockId: BlockId;
  slots: unknown;
  isOpen: boolean;
  isDirty: boolean;
  onToggle: () => void;
  onChange: (slots: unknown) => void;
  onReset: () => void;
}

export function SlotEditorBlock({
  index,
  blockId,
  slots,
  isOpen,
  isDirty,
  onToggle,
  onChange,
  onReset,
}: SlotEditorBlockProps) {
  const block = BLOCK_REGISTRY[blockId];
  // formMeta only depends on the schema (which is module-constant per blockId),
  // so this memo holds for the lifetime of the block. Plain `useMemo` keeps
  // the SlotField tree from being thrown away on each parent re-render.
  const formMeta = useMemo(
    () => zodToFormMetadata(block.meta.slotsSchema),
    [block.meta.slotsSchema],
  );

  if (formMeta.kind !== "object") {
    return null;
  }

  const [category, variant] = blockId.split("/");

  return (
    <div className={cn(isOpen && "bg-zinc-50/40 dark:bg-zinc-950")}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition text-left group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-mono font-medium rounded text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900 shrink-0 tabular-nums">
            {index + 1}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate flex items-center gap-1.5">
              {block.meta.displayName}
              {isDirty && (
                <span
                  aria-label="Edited"
                  className="inline-block w-1.5 h-1.5 rounded-full bg-coral-500 shrink-0"
                />
              )}
            </div>
            <div className="text-[11px] text-zinc-400 dark:text-zinc-600 font-mono truncate">
              {category}/{variant}
            </div>
          </div>
        </div>
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-zinc-400 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3">
          <SlotField
            field={formMeta}
            value={slots}
            onChange={onChange}
            hideLabel
          />

          {isDirty && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1.5 mt-3 h-7 px-2 -mx-1 text-[11px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded transition"
            >
              <RotateCcw size={11} />
              Reset block to original
            </button>
          )}
        </div>
      )}
    </div>
  );
}
