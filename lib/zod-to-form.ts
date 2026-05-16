// ─────────────────────────────────────────────────────────────────────────────
// Zod → form-metadata mapper.
//
// Walks a block's slotsSchema and returns a structured tree the slot-editor
// renderer can consume without ever touching Zod directly. The renderer just
// switches on `kind` and reads typed properties.
//
// Why not react-jsonschema-form: 15 schemas × ~5–10 fields each is ~200 lines
// of mapping; pulling a library would pay for itself only past the 30+ schema
// mark, and the library's default UI would still need overrides for every
// field type.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

export type FormField =
  | StringFormField
  | ImageFormField
  | NumberFormField
  | BooleanFormField
  | EnumFormField
  | ObjectFormField
  | ArrayFormField
  | TupleFormField
  | UnknownFormField;

interface BaseFormField {
  /** The property key in the parent object. Empty string at the root. */
  key: string;
  /** Display label, derived from key or Zod `.describe()`. */
  label: string;
  /** Description from Zod `.describe()` if present. */
  description?: string;
  /** True when this field MUST have a value (not optional, no default). */
  required: boolean;
  /** True when this field has a default value the schema falls back to. */
  hasDefault: boolean;
}

export interface StringFormField extends BaseFormField {
  kind: "string";
  /** Render as <textarea> rather than <input>. */
  multiline: boolean;
  /** Hard cap from Zod `.max()`, if present. */
  maxLength?: number;
  /** Min length from Zod `.min()`, if present. */
  minLength?: number;
  /** Regex source, if present. */
  pattern?: string;
  /** Free-form hint shown next to the input (e.g. regex meaning). */
  patternHint?: string;
}

// Special-cased string-shaped field for image URLs. The renderer swaps in a
// dedicated upload widget instead of the bare text input. Detected from the
// field key (imageSrc / mockupSrc / logoSrc / `src`) at schema-walk time so
// the dispatcher stays a simple switch on `kind`.
export interface ImageFormField extends BaseFormField {
  kind: "image";
  maxLength?: number;
}

export interface NumberFormField extends BaseFormField {
  kind: "number";
  min?: number;
  max?: number;
  integer: boolean;
}

export interface BooleanFormField extends BaseFormField {
  kind: "boolean";
}

export interface EnumFormField extends BaseFormField {
  kind: "enum";
  options: string[];
}

export interface ObjectFormField extends BaseFormField {
  kind: "object";
  fields: FormField[];
}

export interface ArrayFormField extends BaseFormField {
  kind: "array";
  /** The schema describing each item. Synthesized with key=`<n>` per item. */
  itemTemplate: FormField;
  minItems?: number;
  maxItems?: number;
}

export interface TupleFormField extends BaseFormField {
  kind: "tuple";
  /** Fixed-length: one FormField per tuple slot. */
  items: FormField[];
}

/** Fallback for schemas we don't recognize (e.g. ZodUnion, ZodLazy). The
 *  renderer prints a read-only JSON view so the user at least sees the data
 *  rather than a blank spot. */
export interface UnknownFormField extends BaseFormField {
  kind: "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point.
// ─────────────────────────────────────────────────────────────────────────────

export function zodToFormMetadata(
  schema: z.ZodTypeAny,
  key = "",
  parentLabel?: string,
): FormField {
  return buildField(schema, key, parentLabel ?? key, /* required */ true, /* hasDefault */ false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal walker.
//
// Returns a FormField for `schema`. `required` flips to false when we walk
// through ZodOptional/ZodNullable. `hasDefault` flips to true through
// ZodDefault. The `label` is the human-readable derivation of `key` unless a
// Zod `.describe()` short-circuits it.
// ─────────────────────────────────────────────────────────────────────────────

function buildField(
  schema: z.ZodTypeAny,
  key: string,
  label: string,
  required: boolean,
  hasDefault: boolean,
): FormField {
  const def = (schema as { _def?: { typeName?: string } })._def;
  const typeName = def?.typeName;

  // Unwrap optional / nullable / default into the inner schema, accumulating
  // the resolved `required` / `hasDefault` flags so leaf fields see the right
  // values.
  if (typeName === "ZodOptional") {
    const inner = (schema as z.ZodOptional<z.ZodTypeAny>)._def.innerType;
    return buildField(inner, key, label, false, hasDefault);
  }
  if (typeName === "ZodNullable") {
    const inner = (schema as z.ZodNullable<z.ZodTypeAny>)._def.innerType;
    return buildField(inner, key, label, false, hasDefault);
  }
  if (typeName === "ZodDefault") {
    const inner = (schema as z.ZodDefault<z.ZodTypeAny>)._def.innerType;
    return buildField(inner, key, label, false, true);
  }
  if (typeName === "ZodEffects") {
    // Effects wrap an inner schema for refine/transform. The inner type is
    // what the form should render against.
    const inner = (schema as z.ZodEffects<z.ZodTypeAny>)._def.schema;
    return buildField(inner, key, label, required, hasDefault);
  }

  const description = schema.description;
  const displayLabel = description ?? humanize(label);

  const base: BaseFormField = {
    key,
    label: displayLabel,
    description: description && description !== displayLabel ? description : undefined,
    required,
    hasDefault,
  };

  if (typeName === "ZodString") {
    const checks = (schema as z.ZodString)._def.checks as Array<
      { kind: "max"; value: number } | { kind: "min"; value: number } | { kind: "regex"; regex: RegExp; message?: string }
    >;
    let maxLength: number | undefined;
    let minLength: number | undefined;
    let pattern: string | undefined;
    let patternHint: string | undefined;
    for (const c of checks ?? []) {
      if (c.kind === "max") maxLength = c.value;
      else if (c.kind === "min") minLength = c.value;
      else if (c.kind === "regex") {
        pattern = c.regex.source;
        patternHint = c.message ?? describePattern(c.regex.source);
      }
    }
    if (IMAGE_URL_KEYS.has(key)) {
      return {
        ...base,
        kind: "image",
        maxLength,
      };
    }
    return {
      ...base,
      kind: "string",
      multiline: isMultiline(key, maxLength),
      maxLength,
      minLength,
      pattern,
      patternHint,
    };
  }

  if (typeName === "ZodNumber") {
    const checks = (schema as z.ZodNumber)._def.checks as Array<
      | { kind: "min"; value: number }
      | { kind: "max"; value: number }
      | { kind: "int" }
    >;
    let min: number | undefined;
    let max: number | undefined;
    let integer = false;
    for (const c of checks ?? []) {
      if (c.kind === "min") min = c.value;
      else if (c.kind === "max") max = c.value;
      else if (c.kind === "int") integer = true;
    }
    return { ...base, kind: "number", min, max, integer };
  }

  if (typeName === "ZodBoolean") {
    return { ...base, kind: "boolean" };
  }

  if (typeName === "ZodEnum" || typeName === "ZodNativeEnum") {
    const values = (schema as z.ZodEnum<[string, ...string[]]>)._def.values;
    return { ...base, kind: "enum", options: Array.isArray(values) ? values : Object.values(values) };
  }

  if (typeName === "ZodLiteral") {
    const value = (schema as z.ZodLiteral<string | number | boolean>)._def.value;
    return {
      ...base,
      kind: "enum",
      options: [String(value)],
    };
  }

  if (typeName === "ZodObject") {
    const shape = (schema as z.ZodObject<z.ZodRawShape>)._def.shape();
    const fields: FormField[] = Object.entries(shape).map(([childKey, childSchema]) =>
      buildField(childSchema as z.ZodTypeAny, childKey, childKey, true, false),
    );
    return { ...base, kind: "object", fields };
  }

  if (typeName === "ZodArray") {
    const arrDef = (schema as z.ZodArray<z.ZodTypeAny>)._def;
    const itemTemplate = buildField(arrDef.type, singularize(key), singularize(key), true, false);
    return {
      ...base,
      kind: "array",
      itemTemplate,
      minItems: arrDef.minLength?.value,
      maxItems: arrDef.maxLength?.value,
    };
  }

  if (typeName === "ZodTuple") {
    const items = ((schema as z.ZodTuple)._def.items as z.ZodTypeAny[]).map((it, idx) =>
      buildField(it, String(idx), `${humanize(key)} ${idx + 1}`, true, false),
    );
    return { ...base, kind: "tuple", items };
  }

  return { ...base, kind: "unknown" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Heuristics.
// ─────────────────────────────────────────────────────────────────────────────

/** Field keys whose value is almost certainly long-form copy. The body/sub/
 *  description keys cover virtually every multi-line case across the 15 block
 *  schemas; the maxLength fallback (>= 100) catches the rest. */
const MULTILINE_KEY = /\b(body|description|sub|content|paragraph|quote|tagline|blurb|privacy|copyright|answer|note|reasoning)\b/i;

/** String-typed slot keys we treat as image URLs. Matches what `humanize()`
 *  below labels "Image URL" — every block whose schema uses these keys
 *  expects a public image URL (uploaded asset or AI-generated FLUX/Wan
 *  output). `src` is broad but in practice only logos[].src uses it, and the
 *  block component already treats it as an image source. */
const IMAGE_URL_KEYS = new Set(["imageSrc", "mockupSrc", "logoSrc", "src"]);

function isMultiline(key: string, maxLength?: number): boolean {
  if (MULTILINE_KEY.test(key)) return true;
  if (typeof maxLength === "number" && maxLength >= 100) return true;
  // FAQ items use the convention `a` for answer — short key, long content.
  if (key === "a") return true;
  return false;
}

/** "primaryCTA" → "Primary CTA", "imageSrc" → "Image src", "q" → "Q". */
function humanize(key: string): string {
  if (key === "") return "";
  if (key === "a") return "Answer";
  if (key === "q") return "Question";
  if (key === "href") return "Link URL";
  if (key === "src" || key === "imageSrc" || key === "mockupSrc") return "Image URL";
  if (key === "alt" || key === "imageAlt" || key === "mockupAlt") return "Alt text";
  // Split camelCase: "primaryCTA" → "Primary CTA", "isOpen" → "Is open".
  const withSpaces = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
  return withSpaces;
}

/** "items" → "Item", "rows" → "Row", "tiers" → "Tier", "logos" → "Logo".
 *  Falls back to the original key if no simple plural rule applies. */
function singularize(key: string): string {
  if (!key) return "Item";
  if (key.endsWith("ies")) return `${key.slice(0, -3)}y`;
  if (key.endsWith("ses")) return key.slice(0, -2);
  if (key.endsWith("s") && key.length > 1) return key.slice(0, -1);
  return key;
}

/** Friendly hints for the regex patterns we actually have. Falls back to the
 *  raw pattern source so the user at least sees what's being checked. */
function describePattern(source: string): string {
  if (source === "^#[0-9a-fA-F]{6}$") return "Hex colour, e.g. #5E6AD2";
  if (source === "^[a-z][a-z0-9_-]*$") return "Lowercase letters, digits, hyphens, underscores";
  return source;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default value generation — used when adding a new array item or filling in
// a previously optional field the user opted into.
// ─────────────────────────────────────────────────────────────────────────────

export function defaultValueFor(field: FormField): unknown {
  switch (field.kind) {
    case "string":
    case "image":
      return "";
    case "number":
      return field.min ?? 0;
    case "boolean":
      return false;
    case "enum":
      return field.options[0] ?? "";
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const f of field.fields) {
        if (f.required) obj[f.key] = defaultValueFor(f);
      }
      return obj;
    }
    case "array":
      return [];
    case "tuple":
      return field.items.map((it) => defaultValueFor(it));
    default:
      return undefined;
  }
}
