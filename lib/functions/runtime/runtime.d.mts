export type FrameErrorKind = "not_found" | "boot" | "uncaught" | "timeout" | "memory" | "cpu" | "unavailable";

export type Frame =
  | { readonly t: "head"; readonly status: number; readonly headers: [string, string][] }
  | { readonly t: "body"; readonly b: string }
  | { readonly t: "body_end" }
  | { readonly t: "log"; readonly level: "log" | "info" | "warn" | "error" | "debug"; readonly msg: string }
  | { readonly t: "error"; readonly kind: FrameErrorKind; readonly message?: string; readonly stack?: string | null }
  | { readonly t: "end"; readonly ms: number };

export interface InvokeEvent {
  readonly fn: string;
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly headers: [string, string][];
  readonly bodyB64: string | null;
  readonly host: string;
  readonly remoteAddr: string;
}

export interface FrameSink {
  write(chunk: string): unknown;
  end(): unknown;
}

export declare function installGlobals(): void;
export declare function createHandler(loaders: Record<string, () => Promise<unknown>>): (event: InvokeEvent, sink: FrameSink) => Promise<void>;

declare global {
  // Lo que ve el código de una función (Supabase Edge Runtime).
  const Deno: {
    serve(...args: unknown[]): unknown;
    env: { get(k: string): string | undefined; has(k: string): boolean; set(k: string, v: string): void; delete(k: string): void; toObject(): Record<string, string> };
    cwd(): string;
  };
  const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
}
