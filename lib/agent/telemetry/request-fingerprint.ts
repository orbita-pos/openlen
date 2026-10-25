// The fingerprint of one request as it went over the wire (layer 0 of Len 3.1,
// spec local 2026-10-24-len-3-1-layers-0-1, §4.1). Each element is hashed as the
// exact JSON string it is inside the POSTed body, so a reordered key or a dropped
// field is a different message — the class of bug that broke the cache on 24/10.
import { createHash } from "node:crypto";

import type { WireBody } from "@/lib/ai/fireworks-stream-client";

export interface RequestFingerprint {
  readonly systemHash: string | null;
  readonly toolsHash: string | null;
  readonly messageHashes: readonly string[];
  readonly prefixHash: string;
  readonly messageCount: number;
}

const hash16 = (text: string): string => createHash("sha1").update(text).digest("hex").slice(0, 16);

export function fingerprintWire(body: WireBody): RequestFingerprint {
  const first = body.messages[0];
  const hasSystem = first !== undefined && first.role === "system";
  const rest = hasSystem ? body.messages.slice(1) : body.messages;
  const messageHashes = rest.map((m) => hash16(JSON.stringify(m)));
  return {
    systemHash: hasSystem ? hash16(JSON.stringify(first)) : null,
    toolsHash: body.tools?.length ? hash16(JSON.stringify(body.tools)) : null,
    messageHashes,
    prefixHash: hash16(messageHashes.join(",")),
    messageCount: messageHashes.length,
  };
}
