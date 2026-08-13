import { z, type ZodType } from "zod";

import type { ModelTokenUsage } from "../generation/model-cost";

export type FableModelRole = "reasoner" | "designer" | "visual_critic";
export type FireworksReasoningEffort = "none" | "high" | "max";

export interface FireworksTextPart {
  readonly type: "text";
  readonly text: string;
}

export interface FireworksImageUrlPart {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
}

export type FireworksMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string | readonly [FireworksTextPart, FireworksImageUrlPart] };

export interface FireworksJsonRequest<T> {
  role: FableModelRole;
  messages: readonly FireworksMessage[];
  responseSchema: ZodType<T>;
  maxOutputTokens: number;
  reasoningEffort: FireworksReasoningEffort;
  requestId: string;
}

export type FireworksJsonResult<T> =
  | { ok: true; value: T; modelId: string; usage: ModelTokenUsage; durationMs: number; attempts: 1 | 2 }
  | {
      ok: false;
      code: "missing_key" | "timeout" | "http" | "provider" | "invalid_json" | "schema" | "budget_exceeded";
      modelId: string;
      usage?: ModelTokenUsage;
      durationMs: number;
      attempts: 0 | 1 | 2;
    };

type JsonSchema = Record<string, unknown>;

function optionalSchema(schema: z.ZodTypeAny): boolean {
  return schema._def.typeName === z.ZodFirstPartyTypeKind.ZodOptional
    || schema._def.typeName === z.ZodFirstPartyTypeKind.ZodDefault;
}

function numberBounds(checks: readonly Record<string, unknown>[]): JsonSchema {
  const result: JsonSchema = {};
  for (const check of checks) {
    if (check.kind === "int") result.type = "integer";
    if (check.kind === "min" && typeof check.value === "number") result[check.inclusive === false ? "exclusiveMinimum" : "minimum"] = check.value;
    if (check.kind === "max" && typeof check.value === "number") result[check.inclusive === false ? "exclusiveMaximum" : "maximum"] = check.value;
  }
  return result;
}

function stringBounds(checks: readonly Record<string, unknown>[]): JsonSchema {
  const result: JsonSchema = {};
  for (const check of checks) {
    if (check.kind === "min" && typeof check.value === "number") result.minLength = check.value;
    if (check.kind === "max" && typeof check.value === "number") result.maxLength = check.value;
    if (check.kind === "regex" && check.regex instanceof RegExp) result.pattern = check.regex.source;
  }
  return result;
}

/** Converts the bounded Zod response contract into Fireworks' strict JSON Schema payload. */
export function fireworksJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const definition = schema._def as Record<string, unknown>;
  switch (definition.typeName) {
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (definition.shape as () => Record<string, z.ZodTypeAny>)();
      const properties = Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, fireworksJsonSchema(value)]));
      const required = Object.entries(shape).filter(([, value]) => !optionalSchema(value)).map(([key]) => key);
      return { type: "object", properties, required, additionalProperties: false };
    }
    case z.ZodFirstPartyTypeKind.ZodString:
      return { type: "string", ...stringBounds(definition.checks as readonly Record<string, unknown>[]) };
    case z.ZodFirstPartyTypeKind.ZodNumber:
      return { type: "number", ...numberBounds(definition.checks as readonly Record<string, unknown>[]) };
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: "boolean" };
    case z.ZodFirstPartyTypeKind.ZodNull:
      return { type: "null" };
    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return { const: definition.value };
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return { type: "string", enum: definition.values };
    case z.ZodFirstPartyTypeKind.ZodNativeEnum: {
      const values = [...new Set(Object.values(definition.values as Record<string, string | number>).filter((value) => typeof value === "string" || typeof value === "number"))];
      return { enum: values };
    }
    case z.ZodFirstPartyTypeKind.ZodArray: {
      const result: JsonSchema = { type: "array", items: fireworksJsonSchema(definition.type as z.ZodTypeAny) };
      const minLength = definition.minLength as { value: number } | null;
      const maxLength = definition.maxLength as { value: number } | null;
      const exactLength = definition.exactLength as { value: number } | null;
      if (minLength) result.minItems = minLength.value;
      if (maxLength) result.maxItems = maxLength.value;
      if (exactLength) { result.minItems = exactLength.value; result.maxItems = exactLength.value; }
      return result;
    }
    case z.ZodFirstPartyTypeKind.ZodUnion:
      return { anyOf: (definition.options as z.ZodTypeAny[]).map(fireworksJsonSchema) };
    case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
      return { oneOf: [...(definition.options as Map<unknown, z.ZodTypeAny>).values()].map(fireworksJsonSchema) };
    case z.ZodFirstPartyTypeKind.ZodNullable:
      return { anyOf: [fireworksJsonSchema(definition.innerType as z.ZodTypeAny), { type: "null" }] };
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodDefault:
    case z.ZodFirstPartyTypeKind.ZodCatch:
    case z.ZodFirstPartyTypeKind.ZodReadonly:
    case z.ZodFirstPartyTypeKind.ZodBranded:
      return fireworksJsonSchema((definition.innerType ?? definition.type) as z.ZodTypeAny);
    case z.ZodFirstPartyTypeKind.ZodEffects:
      return fireworksJsonSchema(definition.schema as z.ZodTypeAny);
    case z.ZodFirstPartyTypeKind.ZodRecord:
      return { type: "object", additionalProperties: fireworksJsonSchema(definition.valueType as z.ZodTypeAny) };
    case z.ZodFirstPartyTypeKind.ZodTuple:
      return {
        type: "array",
        prefixItems: (definition.items as z.ZodTypeAny[]).map(fireworksJsonSchema),
        minItems: (definition.items as z.ZodTypeAny[]).length,
        maxItems: (definition.items as z.ZodTypeAny[]).length,
      };
    case z.ZodFirstPartyTypeKind.ZodIntersection:
      return { allOf: [fireworksJsonSchema(definition.left as z.ZodTypeAny), fireworksJsonSchema(definition.right as z.ZodTypeAny)] };
    default:
      throw new Error("unsupported strict response schema");
  }
}
