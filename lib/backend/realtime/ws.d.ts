// Los tipos de lo que usamos de `ws` 8 (no hay `@types/ws` instalado: instalar
// una dependencia nueva en la carpeta principal poda lo de otras ramas). Sólo
// el servidor de Realtime (lib/backend/realtime/server.ts) lo usa.
declare module "ws" {
  import type { EventEmitter } from "node:events";
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export type RawData = Buffer | ArrayBuffer | Buffer[];

  export class WebSocket extends EventEmitter {
    static readonly OPEN: 1;
    readonly readyState: 0 | 1 | 2 | 3;
    send(data: string | Uint8Array, opts?: { binary?: boolean }, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    ping(): void;
    on(event: "message", listener: (data: RawData, isBinary: boolean) => void): this;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "pong", listener: () => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(opts: { noServer: true; maxPayload?: number; perMessageDeflate?: boolean });
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, cb: (ws: WebSocket) => void): void;
    close(cb?: () => void): void;
  }
}
