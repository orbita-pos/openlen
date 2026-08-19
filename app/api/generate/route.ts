import { auth } from "@/auth";
import { createProject } from "@/lib/projects";
import { applyModuleIntent } from "@/lib/projects/module-intent";
import { repairUnreadableText } from "@/lib/curate/repair-unreadable-text";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { resolveProfileForCreation } from "@/lib/business-profiles/store";
import { seedBrandIntoHtml } from "@/lib/business-profiles/seed-html";
import type { BusinessProfile, BusinessProfileData } from "@/lib/business-profiles/types";
import { createVersion } from "@/lib/projects/versions";
import { getCreditState } from "@/lib/credits";
import { DESIGN_REFERENCE } from "@/lib/design-guidance";
import { SYSTEM_PROMPT } from "./system-prompt";
import { detectSlotPath, sanitizeForPublish } from "@/lib/html-engine";
import { passHtmlGate } from "@/lib/html-gate/document-gate";
import { collectDegradations } from "@/lib/ingestion/degradations";
import { resolveAIProvider, type AIModel } from "@/lib/ai-provider";
import { generateHtmlStream, pageWriterUsesDeepSeek } from "@/lib/ai-stream/generate";
import { fetchImageAsInlineData } from "@/lib/ai/inline-image";
import { critiqueGeneratedPage } from "@/lib/ai/vision-critique";
import { photographHtml } from "@/lib/imagery/photograph";
import { recordCriticRun, recordRegenOutcome } from "@/lib/ai/quality-metrics";
import type { InlineImage, Message } from "@/lib/ai-gateway";
import { pageMetaFor } from "@/lib/publish/page-meta-intent";
import {
  PLAN_LIMITS,
  checkAndConsume,
  getUserPlan,
  userLimitKey,
} from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate — free-form AI landing-page generation.
//
// Body: { brief: string, model?: "gemini-pro" | "gemini-flash" }
//
// Streams Server-Sent Events as Gemini writes the page:
//   html_chunk    { text }              — sanitized HTML deltas (post-F3 S4)
//   progress      { chars }             — server→client keepalive
//   project_saved { projectId, title }  — terminal success
//   error         { message }
//
// Pipeline (F3 cutover, 2026-05-27):
//   GeminiProvider stream → HtmlStream (sanitize + normalize on end) →
//   SSE wrapper. Credits debit on the upstream `usage` event inside
//   generateHtmlStream; this route only does pre-flight balance gate +
//   post-flight project save. The legacy `reasoning_chunk` + `---HTML---`
//   marker scheme from the Kimi era was dropped — Gemini's
//   instruction-tuning makes raw-HTML output reliable from the first
//   byte.
// ─────────────────────────────────────────────────────────────────────────────

const ENCODER = new TextEncoder();

// CSS recipes, micro-snippets, and brand catalogs ship as a separate
// user-tagged reference block. Gemini 3.x treats long system prompts as
// constraints — pushing taste material into a `<reference>`-tagged user
// turn keeps the model from over-anchoring on phrasing.
const REFERENCE_MESSAGE = `<reference>
The following library is the design taste catalog. Use it as material to draw from when filling in the variant brief — match the register, don't quote verbatim.

${DESIGN_REFERENCE}
</reference>`;

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const brief =
    body &&
    typeof body === "object" &&
    typeof (body as { brief?: unknown }).brief === "string"
      ? (body as { brief: string }).brief.trim()
      : "";
  if (brief.length < 10 || brief.length > 4000) {
    return json({ error: "brief must be 10–4000 characters" }, 400);
  }
  // eslint-disable-next-line no-console
  console.log(`[generate] request — ${brief.length} chars`);

  const modelParam =
    body &&
    typeof body === "object" &&
    typeof (body as { model?: unknown }).model === "string"
      ? (body as { model: string }).model
      : undefined;

  const profileId =
    body &&
    typeof body === "object" &&
    typeof (body as { profileId?: unknown }).profileId === "string"
      ? (body as { profileId: string }).profileId
      : null;

  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Auth required — anonymous /api/generate would let anyone burn API
  // credits without ever creating an account.
  if (!userId) return json({ error: "unauthorized" }, 401);

  const plan = await getUserPlan(userId);

  // Bespoke from-scratch generation is a PRO feature. Free users get the
  // curation path (/api/curate — pick a curated template + fill copy). The
  // client only routes here when "From scratch" is selected, so a free user
  // hitting this gets a graceful upsell instead of a silent no-op.
  if (plan !== "pro") {
    return json(
      {
        error: "pro_only",
        message:
          "From-scratch generation is a Pro feature. Upgrade to Pro, or use the Quick (curated) flow.",
      },
      403,
    );
  }

  // Quota check — hourly + monthly windows defined in lib/limits.ts.
  const decision = await checkAndConsume(
    userLimitKey(userId, "generate"),
    PLAN_LIMITS[plan].generate,
  );
  if (!decision.ok && decision.blocked) {
    return new Response(
      JSON.stringify({
        error: "quota_exceeded",
        scope: decision.blocked.label,
        plan,
        max: decision.blocked.max,
        windowMs: decision.blocked.windowMs,
        resetAt: decision.resetAt?.toISOString(),
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(
            Math.max(
              1,
              Math.ceil(
                ((decision.resetAt?.getTime() ?? Date.now() + 60000) -
                  Date.now()) /
                  1000,
              ),
            ),
          ),
        },
      },
    );
  }

  const PROVIDER = resolveAIProvider(modelParam);
  if (!PROVIDER.key) {
    return json({ error: `${PROVIDER.label} API key missing` }, 500);
  }
  const aiModel: AIModel = modelParam === "gemini-pro" ? "gemini-pro" : "gemini-flash";

  // Resolve the saved business profile up front so we can feed its real facts
  // into the prompt AND seed the finished HTML. resolveProfileForCreation always
  // returns a profile (lazy default); an empty one changes nothing downstream.
  // Best-effort — a resolve failure just yields an unseeded page, never a
  // failed generation.
  let profile: BusinessProfile | null = null;
  try {
    profile = await resolveProfileForCreation(userId, profileId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[generate] profile resolve failed — generating unseeded", err);
  }

  // Sin referencia adjunta, a propósito. Aquí se elegía una plantilla curada,
  // se le mandaba la captura y se le decía "iguala su calidad, densidad,
  // disciplina de espaciado y pulido" — nuestra página otra vez, por otra
  // puerta. Y tenía un efecto que nadie veía: una imagen adjunta fija el turno
  // a Gemini, porque el papel que razona en Fireworks no tiene ojos. Medido en
  // un e2e: `reference template: daybreak` seguido de `calling Gemini 3.5
  // Flash`. Quitarla es lo que deja escribir a DeepSeek.
  let briefBlock = `BRIEF:
${brief}`;

  // Soft-seed the prompt with the user's REAL business facts (if any) so the
  // generated COPY uses them instead of inventing. Empty profile → no block,
  // page is generated exactly as before.
  const businessFacts = profile ? buildBusinessFacts(profile.data) : null;
  if (businessFacts) {
    briefBlock = `${businessFacts}\n\n${briefBlock}`;
  }

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: REFERENCE_MESSAGE },
    { role: "user" as const, content: briefBlock },
  ];

  const upstreamAbort = new AbortController();

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      let keepalive: ReturnType<typeof setInterval> | null = null;
      const closeStream = () => {
        if (closed) return;
        closed = true;
        if (keepalive) {
          clearInterval(keepalive);
          keepalive = null;
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      let totalHtmlChars = 0;
      // Server-to-client keepalive — emit a progress event every 5s so
      // the client watchdog stays reset even if Gemini is silent during
      // its initial "thinking" phase. Cleared in closeStream.
      keepalive = setInterval(() => {
        emit("progress", { chars: totalHtmlChars });
      }, 5000);

      try {
        // Credit gate — one credit is enough to start; the real cost is
        // metered + debited inside generateHtmlStream on the `usage` event.
        const { balance } = await getCreditState(userId);
        if (balance < 1) {
          emit("error", {
            message:
              "Te quedaste sin créditos este mes. Esperá al reset mensual o pasá a Pro.",
          });
          closeStream();
          return;
        }

        // eslint-disable-next-line no-console
        console.log(
          // Quién escribe de verdad, no quién resolvió la clave: el label del
          // proveedor decía "Gemini 3.5 Flash" mientras DeepSeek escribía la
          // página, y sólo la aritmética de créditos lo desmentía.
          `[generate] auth + quota + credits ok — escribe ${pageWriterUsesDeepSeek() ? "DeepSeek" : PROVIDER.label}`,
        );

        // One generation pass: stream HTML chunks to the client, await the
        // canonical post-process HTML, then validate it. Returns the validated
        // document or a user-facing error message. Used for both the initial
        // pass and the (optional) critic-driven regen — the regen re-streams
        // so the live preview shows the better version coming together.
        const runPass = async (
          genMessages: Message[],
          label: string,
        ): Promise<
          | { ok: true; html: string }
          | { ok: false; message: string; retryable: boolean }
        > => {
          const { stream, done } = generateHtmlStream({
            apiKey: PROVIDER.key as string,
            messages: genMessages,
            model: aiModel,
            userId,
            signal: upstreamAbort.signal,
            // Fresh pages have no need for op-ids; they're a chat-tab
            // protocol marker injected at edit time by tagWithOpIds. Saving
            // them with the project bloats every row and re-tagging on every
            // chat turn would still rewrite them, so leave them off.
            htmlOpts: { injectOpIds: false },
            maxOutputTokens: 65_536,
            temperature: 0.8,
          });

          // Pipe per-write HTML chunks to the SSE client as `html_chunk`
          // events. HtmlStream already sanitizes + applies the born-canonical
          // marker pass on end(); the chunks here are the same bytes the
          // final document will contain (sans normalize-time rewrites).
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          let loggedFirst = false;
          while (true) {
            let chunk: ReadableStreamReadResult<Uint8Array>;
            try {
              chunk = await reader.read();
            } catch (readErr) {
              // The stream errored — break out and surface via `done`.
              // eslint-disable-next-line no-console
              console.error(`[generate] reader error (${label})`, readErr);
              break;
            }
            if (chunk.done) break;
            const text = decoder.decode(chunk.value, { stream: true });
            if (text.length > 0) {
              if (!loggedFirst) {
                loggedFirst = true;
                // eslint-disable-next-line no-console
                console.log(`[generate] streaming started (${label})`);
              }
              totalHtmlChars += text.length;
              emit("html_chunk", { text });
            }
          }

          const summary = await done;

          if (summary.stopKind === "error" || !summary.finalHtml) {
            return {
              ok: false,
              message: summary.error?.message ?? "Generation failed — try again.",
              retryable: true,
            };
          }

          // Gemini occasionally wraps the output in ```html...``` fences
          // despite the system prompt forbidding it. Strip a possible fence
          // pair before validating — same safety net the Kimi-era route had.
          const passHtml = stripMarkdownFences(summary.finalHtml);

          if (passHtml.length < 1000 || !/^<!doctype/i.test(passHtml)) {
            return {
              ok: false,
              message:
                "The model didn't return a complete HTML document. Try again.",
              retryable: true,
            };
          }
          if (!/<\/html>\s*$/i.test(passHtml)) {
            return {
              ok: false,
              message:
                summary.stopKind === "max_tokens"
                  ? "The page hit the model's output cap before finishing. Try a shorter, more focused brief."
                  : "The page ended without a closing </html>. Try again.",
              // max_tokens is deterministic — same brief at same cap will hit
              // it again. Truncated streams from upstream congestion ARE
              // retryable.
              retryable: summary.stopKind !== "max_tokens",
            };
          }
          if (detectSlotPath(passHtml)) {
            return {
              ok: false,
              message: "The model emitted editor-mode markers — try again.",
              retryable: false,
            };
          }

          // eslint-disable-next-line no-console
          console.log(
            `[generate] tokens (${label}) — prompt: ${summary.usage?.inputTokens ?? "?"}, output: ${summary.usage?.outputTokens ?? "?"} → ${summary.creditsDebited} credits`,
          );
          return { ok: true, html: passHtml };
        };

        // ── Initial pass ────────────────────────────────────────────────────
        // Auto-retry ONCE on transient failures (truncated streams, garbage
        // output) — Gemini Flash cuts mid-document under load and a fresh
        // attempt usually completes. max_tokens / editor-markers are
        // deterministic and surface immediately. The user pays for the
        // tokens of both attempts on a retry, but that's a 1/20 occurrence
        // and the alternative is a hard "Generation failed" wall.
        let first = await runPass(messages, "initial");
        if (!first.ok && first.retryable) {
          // eslint-disable-next-line no-console
          console.log(
            `[generate] initial pass failed (${first.message}) — auto-retrying`,
          );
          first = await runPass(messages, "initial-retry");
        }
        if (!first.ok) {
          emit("error", { message: first.message });
          closeStream();
          return;
        }
        let html = first.html;
        let regenerated = false;

        // Texto que la página pinta y nadie puede leer. Se mide EN EL RENDER
        // porque el mismo `color:#8a8a92` es correcto sobre negro e ilegible
        // sobre gris, y ningún análisis del CSS distingue los dos. Va antes del
        // crítico: lo que el crítico juzga tiene que ser lo que se entrega.
        //
        // Medido en una página de terror recién generada por esta ruta: dos
        // textos a 1.87 y 1.98 sobre casi negro, siete elementos corregidos.
        // Fail-soft entero — un arreglo cosmético no puede costar la página.
        try {
          // Con plazo: el render vive dentro de la petición del usuario, y un
          // Chrome colgado no puede quedarse con la página que ya está escrita.
          const legible = await Promise.race([
            repairUnreadableText(html, renderVisualQualityViewports),
            new Promise<{ html: string; repaired: number }>((resolve) =>
              setTimeout(() => resolve({ html, repaired: 0 }), 20_000)),
          ]);
          if (legible.repaired > 0) {
            html = legible.html;
            // eslint-disable-next-line no-console
            console.log(`[generate] texto ilegible corregido — ${legible.repaired} elementos`);
          }
        } catch (legibleErr) {
          // eslint-disable-next-line no-console
          console.error("[generate] repairUnreadableText falló — sigue la página tal cual", legibleErr);
        }

        // ── Vision critic loop (Quality S3) ─────────────────────────────────
        // Render the page, show Gemini Flash the screenshot, and regenerate
        // with surgical feedback if the verdict says the page is visually
        // broken. The win is variance reduction — catching the ~5% of broken
        // pages before they reach the user — not raising the average.
        //
        // Kill switch: OPENLEN_VISION_CRITIC=0 falls back to S2 one-shot
        // behavior (no critic call). Default ON. Capped at exactly ONE regen —
        // a flawed page beats a third try the user has to wait on. Born-
        // canonical normalization already ran inside each runPass (HtmlStream
        // .end()), so the chosen final — first pass or regen — is canonical;
        // nothing re-normalizes between critique and regen.
        if (process.env.OPENLEN_VISION_CRITIC !== "0") {
          emit("critic-checking", {});
          const verdict = await critiqueGeneratedPage({
            brief,
            html,
            model: "gemini-3.5-flash",
            apiKey: PROVIDER.key as string,
          });
          recordCriticRun({
            shouldRegenerate: verdict.shouldRegenerate,
            fallback: verdict.fallback,
          });
          // eslint-disable-next-line no-console
          console.log(
            `[critic] regen=${verdict.shouldRegenerate ? "triggered" : "skipped"}`,
          );

          if (verdict.shouldRegenerate) {
            // Reason goes to the client only to drive a neutral "improving the
            // design…" state — never the raw critic text (bad UX to tell a
            // user their page looked bad).
            emit("regen-starting", { reason: verdict.issues.join("; ") });
            const regenBriefBlock = `<critic-feedback>\n${verdict.regenerationFeedback}\n\nIssues found in the previous attempt: ${verdict.issues.join(", ")}\n</critic-feedback>\n\n${briefBlock}`;
            const regenMessages: Message[] = [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: REFERENCE_MESSAGE },
              { role: "user", content: regenBriefBlock },
            ];
            const regen = await runPass(regenMessages, "regen");
            if (regen.ok) {
              html = regen.html;
              regenerated = true;
              recordRegenOutcome(true);
            } else {
              // Regen produced invalid HTML — ship the (already-valid) first
              // pass rather than error or wait for a third try.
              // eslint-disable-next-line no-console
              console.warn(
                `[generate] regen failed validation (${regen.message}) — shipping first pass`,
              );
              recordRegenOutcome(false);
            }
          }
        }

        // ── Born With Imagery ───────────────────────────────────────────────
        // Swap real curated photos into the gradient image-placeholders the
        // model marked (data-ol-photo). Deterministic library match on the
        // model's subject hints — no extra AI call, no network. Soft-fail:
        // a hiccup just keeps the gradient placeholders.
        if (process.env.OPENLEN_IMAGERY !== "0") {
          try {
            const photographed = await photographHtml({ html, brief });
            if (photographed.applied > 0) {
              html = photographed.html;
              // eslint-disable-next-line no-console
              console.log(`[generate] imagery — ${photographed.applied} photo(s) placed`);
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("[generate] imagery failed; keeping gradient placeholders", err);
          }
        }

        // ── Seed + save the chosen final document ───────────────────────────
        const title = extractTitle(html) ?? brief.slice(0, 60).trim();

        // Reuse the profile resolved up front (a save-time resolve only if
        // that failed).
        const business = profile ?? (await resolveProfileForCreation(userId));

        // One gate. `behaviors: "warn"` — this surface FAILS OPEN: the project
        // does not exist yet, and refusing here costs the user a page they
        // waited a minute and paid credits for. It ships and we record what
        // was lost. `seal: false` (publishToDir seals at publish time),
        // `render: false` (the vision critic above already paid the one render
        // this request can afford). Brand seeding rides in `beforeMeta` — the
        // same slot it occupied when it was called inline, unchanged: a
        // generated page DOES take the brand accent (no `recolor: false`
        // here), because it was written for this business, not adopted from
        // someone else's design.
        //
        // The four mutations that used to land after the last sanitize — the
        // Tailwind carrier (a <script>, ours, injected by the stream helper
        // AFTER it sanitizes), the photo swap, the brand seeding, and the head
        // completion — are all upstream of this call now. The document that
        // reaches the DB is one this route sanitized itself, not one it
        // trusted a helper to have cleaned before four more passes touched it.
        const gated = await passHtmlGate(
          html,
          {
            sanitize: sanitizeForPublish,
            beforeMeta: (h) => seedBrandIntoHtml(h, business.data),
          },
          {
            render: false,
            seal: false,
            behaviors: "warn",
            // AUTHORED: written for THIS user from their brief, not cloned.
            meta: pageMetaFor({ provenance: "authored", title, profile: business.data }),
          },
        );
        if (!gated.ok) {
          // Only reachable on the reserved marker (directly, or via
          // `sanitizeForPublish` returning null for the same reason) — and
          // that one never fails open, anywhere. runPass already refuses the
          // model's own markers; this catches bytes the seeding introduced.
          // eslint-disable-next-line no-console
          console.error(`[generate] gate refused (${gated.code}) — not saving`);
          emit("error", {
            message: "The page came out with editor-mode markers — try again.",
          });
          closeStream();
          return;
        }
        html = gated.html;

        // What the page lost on the way in. On the ROW, not in the SSE payload:
        // the client redirects to the workspace on `project_saved`, so a field
        // added there dies on arrival.
        //
        // In practice this is `broken_controls`. Everything else the gate
        // counts was already stripped upstream (the stream sanitizes each
        // write), so the sanitize counters here read zero — which is the
        // honest answer: the model wrote this page, not the user, and telling
        // someone their page "had JavaScript removed" about markup they never
        // typed is the noise this record exists to avoid.
        const degradations = collectDegradations({
          surface: "generate",
          removed: gated.removed,
          behaviorIssues: gated.issues,
        });

        let projectId: string;
        let enabledModules: string[] = [];
        try {
          // AI→módulos bridge: if the page carries a module placeholder, turn
          // that module on so the publish bake wires the real widget.
          const moduleIntent = applyModuleIntent(undefined, html);
          enabledModules = moduleIntent.enabled;
          projectId = await createProject(userId, {
            html,
            brief,
            title,
            profileId: business.id,
            logoUrl: business.data.brand?.logoUrl ?? null,
            settings: moduleIntent.enabled.length ? moduleIntent.settings : undefined,
            degradations: degradations.length > 0 ? degradations : undefined,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[generate] createProject failed", err);
          emit("error", {
            message: "Generated the page but couldn't save it — try again.",
          });
          closeStream();
          return;
        }

        // Telemetry only — the same `[name] ` + one-line-JSON convention
        // publishToDir uses. This used to be the ONLY answer this route had to
        // a control born dead: validate after the row was written and write a
        // line nobody reads. The user's answer is the `broken_controls` record
        // above, which the workspace shows as "algunos controles quedaron mal
        // conectados — pedile al asistente que los arregle". The log stays
        // because it is how we count how often the model does this; it is no
        // longer how the person who owns the page finds out.
        if (gated.issues && gated.issues.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[generate] behavior issues " +
              JSON.stringify({ projectId, issues: gated.issues }),
          );
        }

        await createVersion({
          projectId,
          html,
          label: regenerated ? `Generated (regen): ${title}` : `Generated: ${title}`,
          source: "initial",
        }).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[generate] initial version snapshot failed", err);
        });

        emit("project_saved", { projectId, title, regenerated, enabledModules });
        closeStream();
      } catch (err) {
        upstreamAbort.abort();
        // eslint-disable-next-line no-console
        console.error("[generate] stream failed", err);
        emit("error", {
          message: err instanceof Error ? err.message : "Unknown error",
        });
        closeStream();
      }
    },
    cancel() {
      upstreamAbort.abort();
    },
  });

  return new Response(sse, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const inner = m?.[1]?.trim();
  return inner && inner.length > 0 ? inner.slice(0, 200) : null;
}

// Build a <business> instruction block from the saved profile so the model
// writes the page around the user's REAL facts (name / what-they-do / contact)
// instead of inventing them. Returns null when the profile has nothing real —
// the page is then generated exactly as it was before profiles existed.
function buildBusinessFacts(data: BusinessProfileData): string | null {
  const lines: string[] = [];
  const add = (label: string, v: string | null | undefined) => {
    if (typeof v === "string" && v.trim()) lines.push(`- ${label}: ${v.trim()}`);
  };
  add("Business name", data.business_name);
  add("What they do", data.industry);
  add("Tagline", data.tagline_es ?? data.tagline_en);
  add("Pitch", data.pitch);
  const c = data.contact;
  add("WhatsApp", c?.whatsapp);
  add("Phone", c?.phone);
  add("Email", c?.email);
  add("Address", c?.address);
  add("Instagram", c?.socials?.instagram);
  add("Facebook", c?.socials?.facebook);
  add("TikTok", c?.socials?.tiktok);
  add("Website", c?.socials?.website);
  if (lines.length === 0) return null;
  return `<business>
These are the user's REAL business details. Use them as the page's actual content — the business name, what they do, and any contact info must be these exact values, NOT invented. Weave the contact details into the page naturally (e.g. a contact section / footer). Do not fabricate other contact methods.
${lines.join("\n")}
</business>`;
}

function stripMarkdownFences(s: string): string {
  let out = s.trim();
  out = out.replace(/^```(?:html|xml)?[\t ]*\r?\n?/i, "");
  out = out.replace(/\r?\n?[\t ]*```\s*$/i, "");
  return out.trim();
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
