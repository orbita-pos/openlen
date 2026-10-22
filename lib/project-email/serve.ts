// lib/project-email/serve.ts — THE /email/v1 GATEWAY WITH THE REAL THINGS (spec local
// 2026-10-22-email-integration, 6.3): the host → the backend (its draft's own
// ref makes it the draft, as /ai/v1), and the sending core's real deps.

import "server-only";

import { backendForHost } from "@/lib/backend/registry";

import { emailEnabledIn } from "./enabled";
import { handleEmailRequest } from "./gateway";
import { realSendDeps } from "./real";

export function serveProjectEmail(req: Request): Promise<Response> {
  return handleEmailRequest(req, {
    ...realSendDeps(),
    enabled: () => emailEnabledIn(),
    async resolve(r) {
      const host = (r.headers.get("host") ?? new URL(r.url).host).toLowerCase().replace(/:\d+$/, "");
      const hb = await backendForHost(host);
      if (!hb) return null;
      return { projectId: hb.record.projectId, environment: hb.environment ?? "live", secretKeyHash: hb.record.secretKeyHash };
    },
  });
}
