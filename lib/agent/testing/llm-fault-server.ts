// A scripted OpenAI-compatible provider on 127.0.0.1 (layer 1 of Len 3.1, spec
// local 2026-10-24-len-3-1-layers-0-1, §5.4), after DeepSeek's LLM fault
// server: each path (`/deepinfra`, `/fireworks`) answers its own list of steps
// — a normal streamed answer, a reset before the first byte, a disconnect in the
// middle, an empty completion, an HTTP error, a stall — so the real stream client,
// the brain's fallback and the loop's retries run against real sockets. A path
// whose script ran out answers 500 «script exhausted»: a test that asks for more
// than it scripted fails loud. Test-only code.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type FaultStep =
  | {
      kind: "ok";
      text: string;
      /** Thinking streamed before the text (`reasoning_content`). */
      reasoning?: string;
      /** Calls the model makes in this answer (finish_reason becomes `tool_calls`). */
      toolCalls?: { name: string; arguments: string }[];
      usage?: { prompt_tokens: number; completion_tokens: number; cached_tokens?: number };
    }
  | { kind: "reset_before_first_event" }
  | { kind: "disconnect_after"; chunks: number; text?: string }
  | { kind: "empty_completion" }
  | { kind: "http"; status: 429 | 500 | 503; retryAfterS?: number }
  | { kind: "stall_ms"; ms: number };

export interface FaultServer {
  url(path: string): string;
  /** How many requests a path received. */
  requests(path: string): number;
  close(): Promise<void>;
}

const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ id: "fault", object: "chat.completion.chunk", model: "fault-model", choices: [{ index: 0, delta, ...extra }] })}\n\n`;

/** The text in pieces of at most 4 characters, like a stream. */
const pieces = (text: string): string[] => text.match(/[\s\S]{1,4}/g) ?? [];

function sseHead(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
}

async function answer(step: FaultStep, req: IncomingMessage, res: ServerResponse): Promise<void> {
  switch (step.kind) {
    case "ok": {
      sseHead(res);
      res.write(chunk({ role: "assistant", content: "" }));
      for (const p of pieces(step.reasoning ?? "")) res.write(chunk({ reasoning_content: p }));
      for (const p of pieces(step.text)) res.write(chunk({ content: p }));
      (step.toolCalls ?? []).forEach((c, index) =>
        res.write(chunk({ tool_calls: [{ index, id: `call_${index}`, type: "function", function: { name: c.name, arguments: c.arguments } }] })),
      );
      const u = step.usage ?? { prompt_tokens: 100, completion_tokens: 10 };
      res.write(
        `data: ${JSON.stringify({
          id: "fault",
          object: "chat.completion.chunk",
          model: "fault-model",
          choices: [{ index: 0, delta: {}, finish_reason: step.toolCalls?.length ? "tool_calls" : "stop" }],
          usage: {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.prompt_tokens + u.completion_tokens,
            prompt_tokens_details: { cached_tokens: u.cached_tokens ?? 0 },
          },
        })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
      return;
    }
    case "reset_before_first_event":
      req.socket.destroy();
      return;
    case "disconnect_after": {
      sseHead(res);
      for (const p of pieces(step.text ?? "partial answer that never ends").slice(0, step.chunks)) res.write(chunk({ content: p }));
      // Let the bytes leave before the socket goes.
      await new Promise((resolve) => setTimeout(resolve, 20));
      req.socket.destroy();
      return;
    }
    case "empty_completion":
      sseHead(res);
      res.write(chunk({ role: "assistant", content: "" }));
      res.write(
        `data: ${JSON.stringify({
          id: "fault",
          object: "chat.completion.chunk",
          model: "fault-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 },
        })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
      return;
    case "http":
      res.writeHead(step.status, {
        "content-type": "application/json",
        ...(step.retryAfterS !== undefined ? { "retry-after": String(step.retryAfterS) } : {}),
      });
      res.end(JSON.stringify({ error: { message: `scripted ${step.status}` } }));
      return;
    case "stall_ms":
      await new Promise((resolve) => setTimeout(resolve, step.ms));
      if (!res.destroyed) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "stalled" } }));
      }
      return;
  }
}

export async function startFaultServer(script: Record<string, FaultStep[]>): Promise<FaultServer> {
  const queues = new Map(Object.entries(script).map(([path, steps]) => [path, [...steps]]));
  const counts = new Map<string, number>();
  const server = createServer((req, res) => {
    const path = `/${(req.url ?? "/").split("/")[1] ?? ""}`;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    req.resume();
    req.on("end", () => {
      const step = queues.get(path)?.shift();
      if (!step) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `script exhausted for ${path}` } }));
        return;
      }
      void answer(step, req, res).catch(() => req.socket.destroy());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (path) => `http://127.0.0.1:${port}${path}/v1/chat/completions`,
    requests: (path) => counts.get(path) ?? 0,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
