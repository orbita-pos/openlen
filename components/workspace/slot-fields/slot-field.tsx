"use client";

import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  defaultValueFor,
  type ArrayFormField,
  type FormField,
  type ObjectFormField,
  type TupleFormField,
} from "@/lib/zod-to-form";
import { StringField } from "./string-field";
import { NumberField } from "./number-field";
import { BooleanField } from "./boolean-field";
import { EnumField } from "./enum-field";
import { ImageField } from "./image-field";

export interface SlotFieldProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  /** When true, show an X button to clear the value back to undefined.
   *  Only applied to the top level of an optional subtree. */
  clearable?: boolean;
  /** Hide the label header — used at the root level of a block where the
   *  block heading already labels the form. */
  hideLabel?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Single dispatcher for the whole form tree. Each kind handles its own
// rendering; arrays/objects recurse back through this component.
//
// Optional fields with no value collapse to a "+ Add <label>" affordance.
// The user opts in by clicking the button, which seeds a default value
// derived from the schema. The X button reverses that.
// ─────────────────────────────────────────────────────────────────────────────

export function SlotField({
  field,
  value,
  onChange,
  clearable = false,
  hideLabel = false,
}: SlotFieldProps) {
  const isUnset = value === undefined || value === null;
  const isOptional = !field.required;

  if (isOptional && isUnset) {
    return (
      <button
        type="button"
        onClick={() => onChange(defaultValueFor(field))}
        className="flex items-center gap-1.5 h-7 px-2 -mx-1 text-[12px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded transition"
      >
        <Plus size={12} />
        Add {field.label.toLowerCase()}
      </button>
    );
  }

  return (
    <div className={cn(field.kind === "object" || field.kind === "tuple" ? "space-y-2" : "")}>
      {!hideLabel && field.kind !== "boolean" && (
        <FieldLabel
          label={field.label}
          required={field.required}
          onClear={isOptional && clearable ? () => onChange(undefined) : undefined}
        />
      )}
      {field.kind === "boolean" ? (
        <div className="flex items-center justify-between gap-2">
          <FieldLabel label={field.label} required={field.required} compact />
          <BooleanField
            field={field}
            value={value === true}
            onChange={onChange}
          />
        </div>
      ) : field.kind === "string" ? (
        <StringField
          field={field}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      ) : field.kind === "image" ? (
        <ImageField
          field={field}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      ) : field.kind === "number" ? (
        <NumberField
          field={field}
          value={typeof value === "number" ? value : Number.NaN}
          onChange={onChange}
        />
      ) : field.kind === "enum" ? (
        <EnumField
          field={field}
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      ) : field.kind === "object" ? (
        <ObjectFieldBody
          field={field}
          value={(value ?? {}) as Record<string, unknown>}
          onChange={onChange}
        />
      ) : field.kind === "array" ? (
        <ArrayFieldBody
          field={field}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      ) : field.kind === "tuple" ? (
        <TupleFieldBody
          field={field}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      ) : (
        <UnknownFieldBody value={value} />
      )}
    </div>
  );
}

function FieldLabel({
  label,
  required,
  compact,
  onClear,
}: {
  label: string;
  required: boolean;
  compact?: boolean;
  onClear?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2",
        compact ? "text-[12px]" : "text-[11px]",
      )}
    >
      <span className="font-medium text-zinc-600 dark:text-zinc-400 uppercase tracking-wide flex items-center gap-1">
        {label}
        {!required && (
          <span
            aria-hidden="true"
            className="text-[9px] text-zinc-300 dark:text-zinc-700 font-normal normal-case tracking-normal"
          >
            optional
          </span>
        )}
      </span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="text-zinc-400 hover:text-red-500 transition"
          aria-label="Remove"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Object body — recurse into each child field with sub-value + sub-onChange.
// ─────────────────────────────────────────────────────────────────────────────

function ObjectFieldBody({
  field,
  value,
  onChange,
}: {
  field: ObjectFormField;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2.5 pl-2 border-l border-zinc-100 dark:border-zinc-900">
      {field.fields.map((child) => (
        <SlotField
          key={child.key}
          field={child}
          value={value?.[child.key]}
          onChange={(childValue) => {
            if (childValue === undefined) {
              const next = { ...value };
              delete next[child.key];
              onChange(next);
              return;
            }
            onChange({ ...value, [child.key]: childValue });
          }}
          clearable
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Array body — each item renders the array's itemTemplate. Add/remove buttons
// honour minItems/maxItems from the Zod schema so the user can't break the
// validator with the UI.
// ─────────────────────────────────────────────────────────────────────────────

function ArrayFieldBody({
  field,
  value,
  onChange,
}: {
  field: ArrayFormField;
  value: unknown[];
  onChange: (v: unknown[]) => void;
}) {
  const canRemove = typeof field.minItems !== "number" || value.length > field.minItems;
  const canAdd = typeof field.maxItems !== "number" || value.length < field.maxItems;

  return (
    <div className="space-y-2">
      {value.map((item, i) => (
        <div
          key={i}
          className="rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-900/30"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-600 uppercase tracking-wider">
              {field.itemTemplate.label} {i + 1}
            </span>
            {canRemove && (
              <button
                type="button"
                onClick={() =>
                  onChange(value.filter((_, j) => j !== i))
                }
                className="text-zinc-400 hover:text-red-500 transition"
                aria-label={`Remove ${field.itemTemplate.label} ${i + 1}`}
              >
                <X size={12} />
              </button>
            )}
          </div>
          <SlotField
            field={field.itemTemplate}
            value={item}
            onChange={(itemValue) =>
              onChange(value.map((v, j) => (j === i ? itemValue : v)))
            }
            hideLabel
          />
        </div>
      ))}
      {canAdd && (
        <button
          type="button"
          onClick={() => onChange([...value, defaultValueFor(field.itemTemplate)])}
          className="flex items-center gap-1.5 h-7 px-2 text-[12px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded transition w-full"
        >
          <Plus size={12} />
          Add {field.itemTemplate.label.toLowerCase()}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tuple body — same shape as array but fixed-length, no add/remove.
// (Pricing/two-tier-simple uses `z.tuple([tier, tier])`.)
// ─────────────────────────────────────────────────────────────────────────────

function TupleFieldBody({
  field,
  value,
  onChange,
}: {
  field: TupleFormField;
  value: unknown[];
  onChange: (v: unknown[]) => void;
}) {
  return (
    <div className="space-y-2">
      {field.items.map((slot, i) => (
        <div
          key={i}
          className="rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 p-2.5 bg-zinc-50/50 dark:bg-zinc-900/30"
        >
          <div className="mb-2">
            <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-600 uppercase tracking-wider">
              {slot.label}
            </span>
          </div>
          <SlotField
            field={slot}
            value={value[i]}
            onChange={(itemValue) =>
              onChange(value.map((v, j) => (j === i ? itemValue : v)))
            }
            hideLabel
          />
        </div>
      ))}
    </div>
  );
}

function UnknownFieldBody({ value }: { value: unknown }) {
  return (
    <pre className="text-[11px] text-zinc-500 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-900 p-2 rounded overflow-x-auto max-h-32">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
