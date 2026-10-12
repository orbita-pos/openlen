/**
 * LA TARJETA SEGURA — `request_secrets` (spec local 2026-10-11, Parte 4).
 *
 * Len pide secretos POR SU NOMBRE (el que leerá `Deno.env.get`), con para qué y
 * dónde sacarlos. La tarjeta pinta dos campos por secreto —borrador y la
 * publicada— y manda los valores DIRECTOS a `/api/projects/[id]/function-secrets`.
 * Por el turno sólo viaja qué se guardó dónde: Len nunca ve un valor, ni en el
 * historial, ni en la grabación, ni en la transcripción.
 *
 * La mecánica es la de `ask_user_question` (espera dentro del turno, 120 s,
 * vencida cierra el turno con la tarjeta), con la intención `secrets`, como las
 * del modo plan. Lo que vuelve se lee del ALMACÉN, no de lo que dice el chat.
 */
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import {
  ASK_CANCELLED_ERROR,
  QUESTION_DISMISSED,
  REQUEST_SECRETS,
  SECRETS_QUESTION_ID,
  questionText,
  type SecretRequest,
  type UserQuestion,
} from "@/lib/agent/ask-user-question";
import { secretNameMessage, secretNameProblem } from "@/lib/functions/secret-names";

const MAX_SECRETS = 5;
const DESCRIPTION_MAX = 300;
const URL_MAX = 500;

export const REQUEST_SECRETS_DECLARATION: Record<string, unknown> = {
  name: REQUEST_SECRETS,
  description:
    "Ask the user for secret values the project's Edge Functions need — API keys, webhook signing secrets, access tokens — in a secure card. "
    + "You never see the values: the card saves them straight to the project's secrets, and the functions read them with Deno.env.get(name). "
    + "The card has a field for the draft (what the canvas, curl and your tools run: e.g. a Stripe test key) and one for the published site (e.g. the live key); the user may leave production for later. "
    + "Never ask for a secret in chat or with ask_user_question. The result says where each one was saved.",
  parameters: {
    type: "OBJECT",
    properties: {
      secrets: {
        type: "ARRAY",
        description: "Up to 5 secrets, in the order the user should fill them.",
        items: {
          type: "OBJECT",
          properties: {
            name: {
              type: "STRING",
              description: "The name the functions read with Deno.env.get, e.g. STRIPE_SECRET_KEY: a letter, then letters, digits and underscores; not SUPABASE_*.",
            },
            description: { type: "STRING", description: "What it is for, in one sentence, in the user's language." },
            url: { type: "STRING", description: "Optional: the https page where the user gets it, e.g. https://dashboard.stripe.com/test/apikeys." },
          },
          required: ["name", "description"],
        },
      },
    },
    required: ["secrets"],
  },
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** La forma, validada ANTES de enseñar nada. Los errores le hablan al modelo. */
export function validateSecretRequests(raw: unknown): { ok: true; secrets: SecretRequest[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: '"secrets" must be a non-empty array of { name, description, url? }.' };
  if (raw.length > MAX_SECRETS) return { ok: false, error: "Ask for at most 5 secrets at a time; ask for the rest after these." };
  const secrets: SecretRequest[] = [];
  for (const [i, s] of raw.entries()) {
    if (!isObject(s)) return { ok: false, error: `secrets[${i}] must be an object.` };
    const name = text(s.name);
    const p = secretNameProblem(name);
    if (p) return { ok: false, error: `secrets[${i}].name: ${secretNameMessage(name, p)}` };
    if (secrets.some((x) => x.name === name)) return { ok: false, error: `secrets[${i}].name "${name}" is repeated.` };
    const description = text(s.description).slice(0, DESCRIPTION_MAX);
    if (!description) return { ok: false, error: `secrets[${i}] ("${name}") needs a "description": what it is for, as the user will read it.` };
    const url = text(s.url);
    if (url && (!/^https:\/\/\S+$/.test(url) || url.length > URL_MAX)) return { ok: false, error: `secrets[${i}].url must be an https:// URL.` };
    secrets.push(url ? { name, description, url } : { name, description });
  }
  return { ok: true, secrets };
}

/** La pregunta que pinta la tarjeta. Su texto es nuestro (en inglés, como el
 *  del modo plan): la barra y la tarjeta dicen los suyos, traducidos. */
export function secretsQuestion(secrets: readonly SecretRequest[]): UserQuestion {
  return {
    id: SECRETS_QUESTION_ID,
    question: `Enter the secret values for: ${secrets.map((s) => s.name).join(", ")}.`,
    intent: { kind: "secrets", secrets: [...secrets] },
  };
}

/** Lo que lee Len: dónde quedó CADA nombre, según el almacén. */
export function secretsResult(requested: readonly string[], names: { readonly draft: readonly string[]; readonly live: readonly string[] }): string {
  const lineas = requested.map((n) => {
    const donde = [...(names.draft.includes(n) ? ["draft"] : []), ...(names.live.includes(n) ? ["production"] : [])];
    return donde.length > 0 ? `${n} saved in: ${donde.join(", ")}` : `${n} skipped`;
  });
  const faltaProduccion = requested.some((n) => names.draft.includes(n) && !names.live.includes(n));
  if (faltaProduccion) lineas.push("Production values are set by the user (you can't): the publish card asks for any that are missing.");
  return lineas.join("\n");
}

export async function toolRequestSecrets(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const v = validateSecretRequests(args.secrets);
  if (!v.ok) return { response: { ok: false, error: v.error } };
  if (!deps.functionSecretNames) return { response: { ok: false, error: "Edge Function secrets aren't available on this server." } };
  const preguntas = [secretsQuestion(v.secrets)];
  // Como `ask_user_question`: sin quien conteste dentro del turno (la voz,
  // Len-Bench), la tarjeta cierra el turno y se rellena después.
  if (deps.askUser) {
    const answers = await deps.askUser(preguntas);
    if (answers === QUESTION_DISMISSED) return { response: { ok: false, error: ASK_CANCELLED_ERROR }, preguntas, dismissed: true };
    if (answers) {
      const names = await deps.functionSecretNames(session.projectId);
      if (!names) return { response: { ok: false, error: "Edge Function secrets aren't available on this server." }, preguntas };
      const result = secretsResult(v.secrets.map((s) => s.name), names);
      return { response: { ok: true, result }, preguntas, respuesta: result.split("\n").slice(0, v.secrets.length).join(" · ").slice(0, 200) };
    }
  }
  return { response: { ok: true, preguntado: true }, pregunta: questionText(preguntas), preguntas };
}
