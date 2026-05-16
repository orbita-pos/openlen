import { auth } from "@/auth";
import { generateLandingPage, BudgetExceededError } from "@/lib/orchestrator";
import { GenerateRequestSchema } from "@/lib/orchestrator/types";
import type {
  ErrorEvent,
  ProgressEvent,
  ProjectSavedEvent,
  ResultEvent,
  SseEvent,
  StepResultEvent,
} from "@/lib/orchestrator/types";
import { createProject, deriveTitle } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate
//
// Accepts { brief, maxBudget?, fastPath? } and returns a Server-Sent Events
// stream:
//   event: progress       { step, status, details?, costSoFar? }
//   event: step_result    { step, data }
//   event: result         { page: LandingPage }
//   event: project_saved  { projectId, title }   ← only when user is signed in
//   event: error          { message, recoverable, step? }
//
// The stream closes after `project_saved` (or `result` for anonymous calls)
// or a non-recoverable `error`.
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

  const session = await auth();
  const userId = session?.user?.id ?? null;

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

        // Persist to projects table when we know who the caller is. Failures
        // here are surfaced as a non-fatal error event — the page itself was
        // already generated and streamed back, so the user still gets value.
        if (userId) {
          try {
            const projectId = await createProject(userId, page);
            const saved: ProjectSavedEvent = {
              type: "project_saved",
              projectId,
              title: deriveTitle(page),
            };
            send(saved);
          } catch (err) {
            const errorEvent: ErrorEvent = {
              type: "error",
              message: `Could not save project: ${err instanceof Error ? err.message : String(err)}`,
              recoverable: true,
            };
            send(errorEvent);
          }
        }
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
