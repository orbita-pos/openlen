import { generateLandingPage, BudgetExceededError } from "@/lib/orchestrator";
import { GenerateRequestSchema } from "@/lib/orchestrator/types";
import type {
  ErrorEvent,
  ProgressEvent,
  ResultEvent,
  SseEvent,
  StepResultEvent,
} from "@/lib/orchestrator/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate
//
// Accepts { brief, maxBudget?, fastPath? } and returns a Server-Sent Events
// stream:
//   event: progress  { step, status, details?, costSoFar? }
//   event: error     { message, recoverable, step? }
//   event: result    { page: LandingPage }
//
// The stream closes after `result` or a non-recoverable `error`.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const encoder = new TextEncoder();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(`Invalid request: ${parsed.error.message}`);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SseEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const page = await generateLandingPage({
          ...parsed.data,
          onProgress: (e: ProgressEvent) => send(e),
          onStepResult: (e: StepResultEvent) => send(e),
        });
        const result: ResultEvent = { type: "result", page };
        send(result);
      } catch (err) {
        const errorEvent: ErrorEvent = mapError(err);
        send(errorEvent);
      } finally {
        controller.enqueue(encoder.encode(": end\n\n"));
        controller.close();
      }
    },
    cancel() {
      // Client disconnected — the in-flight orchestrator promise will keep
      // running to completion. Witness file is still written. That's
      // acceptable for Phase 1; Phase 2 should plumb an AbortSignal through.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function mapError(err: unknown): ErrorEvent {
  if (err instanceof BudgetExceededError) {
    return {
      type: "error",
      message: err.message,
      recoverable: false,
    };
  }
  return {
    type: "error",
    message: err instanceof Error ? err.message : String(err),
    recoverable: false,
  };
}
