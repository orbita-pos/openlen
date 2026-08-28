import type { StreamEvent, StreamRequest } from "@/lib/ai-gateway";
import type { ModelOperation } from "@/lib/generation/model-policy";
import { createFireworksStreamClient } from "./fireworks-stream-client";

// lib/ai/fireworks-as-stream-provider.ts — presentar Fireworks con la misma
// forma que el proveedor de Gemini.
//
// POR QUÉ EXISTE. Al mover el texto y la visión fuera de Gemini, cada superficie
// —los ojos del Agente, el crítico de crear, el rediseño, la traducción— acabó
// escribiendo el MISMO adaptador a mano: mapear los papeles, pasar las imágenes,
// pedir JSON, elegir la operación. Cuatro copias del mismo puente es
// exactamente la forma que tenían el Chat y el Agente antes de `persistPage`, y
// el comentario de aquel decía por qué no podían derivar nunca.
//
// LO QUE NO SE RELAJA. Sin esquema estricto: el modo estricto de Fireworks
// rechaza esquemas válidos —medido— y cada llamador ya valida lo que recibe
// tolerando vallas de markdown y texto alrededor. Aquí se pide un objeto JSON
// cuando hace falta y se valida donde siempre se validó.
//
// QUÉ MODELO CORRE lo decide la política por `operation`
// (`lib/generation/model-policy.ts`): el razonador para texto, Qwen para
// lo que mira. Al razonador NUNCA se le manda una imagen.

/**
 * La petición, con `model` OPCIONAL: por este camino el modelo lo decide la
 * política a partir de `operation`, no el llamador. Exigirlo obligaría a
 * inventar un identificador que se ignora, que es peor que no pedirlo.
 */
export type FlexibleStreamRequest = Omit<StreamRequest, "model"> & { model?: string };

/** La superficie mínima que comparten el proveedor de Gemini y éste. */
export interface StreamProviderLike {
  stream(
    request: FlexibleStreamRequest,
    opts: { signal?: AbortSignal },
  ): AsyncIterableIterator<StreamEvent>;
}

export interface FireworksProviderOpts {
  /** Aparece en las trazas del cliente. Que nombre la superficie, no el modelo. */
  readonly requestId: string;
  /** La política traduce esto a modelo y esfuerzo de razonamiento. */
  readonly operation: ModelOperation;
  /** Techo por defecto si la petición no trae el suyo. */
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  /** Pedir un objeto JSON. Los críticos y la traducción lo necesitan; el que
   *  escribe una página entera NO —ahí la salida es HTML. */
  readonly jsonObject?: boolean;
}

/** Los papeles del gateway no coinciden uno a uno con los del wire. */
function rol(role: StreamRequest["messages"][number]["role"]) {
  if (role === "assistant") return "assistant" as const;
  if (role === "system") return "system" as const;
  return "user" as const;
}

export function fireworksStreamProvider(opts: FireworksProviderOpts): StreamProviderLike {
  const client = createFireworksStreamClient();
  return {
    stream(request, streamOpts) {
      return client.stream(
        {
          messages: request.messages.map((m) => ({ role: rol(m.role), content: m.content })),
          // Las imágenes viajan sólo si la petición las trae: una operación de
          // texto que reciba una imagen iría al razonador, que no tiene ojos.
          ...(request.images?.length ? { images: request.images } : {}),
          ...(opts.jsonObject ? { jsonObject: true } : {}),
          maxOutputTokens: request.maxOutputTokens ?? opts.maxOutputTokens ?? 2_048,
          temperature: request.temperature ?? opts.temperature ?? 0.1,
          requestId: opts.requestId,
          operation: opts.operation,
        },
        streamOpts,
      ) as AsyncIterableIterator<StreamEvent>;
    },
  };
}
