import type { FireworksJsonClient } from "@/lib/ai/fireworks-client";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import type { CreativeDirection } from "@/lib/generation/creative-contracts";
import { AestheticChoiceSchema, chooseCreativeDirection } from "@/lib/generation/choose-creative-direction";
import { reasoningEffortFor } from "@/lib/generation/fable-model-policy";

/**
 * El elector, atado al transporte de la página.
 *
 * El módulo posee el prompt y el contrato; aquí sólo vive la red. El cliente es
 * el mismo que paga el resto de la página, así que esta llamada entra en el
 * único presupuesto de la solicitud en vez de abrir uno paralelo.
 */
export function electCreativeDirectionWith(
  client: FireworksJsonClient,
  projectId: string,
): (brief: string, intent: IntentAnalysis) => Promise<CreativeDirection | null> {
  return (brief, intent) => chooseCreativeDirection(brief, intent, {
    ask: async (system, user) => {
      const result = await client.request({
        role: "reasoner",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        responseSchema: AestheticChoiceSchema,
        maxOutputTokens: 512,
        reasoningEffort: reasoningEffortFor("reasoner", "creative_direction"),
        requestId: `${projectId}:direction`,
        // Un solo intento: una negativa reintentada es la misma negativa con
        // factura, y la página ya tiene su dirección de respaldo.
        maxAttempts: 1,
      });
      if (!result.ok) throw new Error(result.code);
      return JSON.stringify(result.value);
    },
  });
}
