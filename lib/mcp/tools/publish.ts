// publish y unpublish: el canal público. Con aprobación de la persona en
// openlen.com (salvo republicar en el mismo subdominio desde la misma conexión
// que ya tuvo una), y por las MISMAS funciones que el botón Publicar.
import * as z from "zod4";
import { AppNoCompilaError, textoDeDiagnostico } from "@/lib/apps/compilador";
import { DataChangesNeedOwnerError, dataChangesErrorBody } from "@/lib/backend/data-changes";
import {
  ProjectNotFoundError,
  publishProject,
  SubdomainInvalidError,
  SubdomainLimitError,
  SubdomainTakenError,
  unpublishProject,
} from "@/lib/projects";
import { conAutor } from "@/lib/projects/autor-del-cambio";
import { securityReviewer } from "@/lib/security-review/real";
import { agentBlockedText, ENDING_FOR_MCP } from "@/lib/security-review/view";
import { validateSubdomain } from "@/lib/subdomain/validate";
import { openProject } from "../access";
import { approvalUrl, checkApproval, createApproval, hasTrustedPublish, markApprovalUsed, type ApprovalRequest } from "../approvals";
import { editorUrl } from "../config";
import { consumeQuota } from "../quota";
import { jsonResult, toolError, type ToolResult } from "../results";
import { defineTool, type ToolAnnotations } from "./define";

export const PUBLISH_ANNOTATIONS: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

type ApprovalState = Awaited<ReturnType<typeof checkApproval>>;

const APPROVAL_PROBLEMS: Record<Exclude<ApprovalState, "ok">, [string, string]> = {
  pending: ["approval_pending", "The user hasn't approved it yet. Ask them to open the approval link, then try again."],
  denied: ["approval_denied", "The user denied this. Don't try again unless they ask you to."],
  expired: ["approval_expired", "The approval expired. Call the tool again without approval_id to get a new link."],
  used: ["approval_used", "That approval was already used. Call the tool again without approval_id to get a new link."],
  mismatch: ["approval_mismatch", "That approval was given for something else (another project, address or connection)."],
  not_found: ["approval_not_found", "There is no approval with that id."],
};

/** null = aprobado y listo para hacerse; si no, lo que recibe el modelo. */
async function gate(req: ApprovalRequest, approvalId: string | undefined, trusted: boolean): Promise<ToolResult | null> {
  if (trusted) return null;
  if (!approvalId) {
    const a = await createApproval(req);
    return jsonResult({
      status: "approval_required",
      approval_id: a.id,
      approval_url: approvalUrl(a.id),
      expires_at: a.expiresAt.toISOString(),
      next_step:
        "Show approval_url to the user and ask them to approve it in their browser. When they say it's done, call this tool again with the same arguments plus approval_id.",
    });
  }
  const state = await checkApproval(approvalId, req);
  if (state === "ok") return null;
  const [code, message] = APPROVAL_PROBLEMS[state];
  return toolError(code, message);
}

function publishError(err: unknown, projectId: string): ToolResult {
  if (err instanceof SubdomainInvalidError) return toolError("invalid_subdomain", `That address is ${err.reason}. Use lowercase letters, numbers and hyphens.`);
  if (err instanceof SubdomainTakenError) return toolError("subdomain_taken", "That address is taken. Ask the user for another one.");
  if (err instanceof SubdomainLimitError) {
    return toolError(
      "limit_reached",
      `The user's plan allows ${err.limit} published projects and they are all in use. They can unpublish one or upgrade at openlen.com.`,
    );
  }
  if (err instanceof ProjectNotFoundError) return toolError("not_found", "The project no longer exists.");
  if (err instanceof AppNoCompilaError) {
    return toolError(
      "app_does_not_compile",
      `The app doesn't compile, so it can't be published. Fix these and publish again:\n${err.errores.map(textoDeDiagnostico).join("\n")}`,
    );
  }
  if (err instanceof DataChangesNeedOwnerError) {
    return toolError(
      "needs_owner",
      `This publish includes database changes; the person must publish it once from the OpenLen editor to review them: ${editorUrl(projectId)}`,
    );
  }
  const data = dataChangesErrorBody(err);
  if (data) {
    return toolError(
      "data_changes_failed",
      `The database changes could not be applied (${String(data.body.error)}). Publish from the OpenLen editor to see the details: ${editorUrl(projectId)}`,
    );
  }
  throw err;
}

export const publishTool = defineTool({
  name: "publish",
  title: "Publish",
  description:
    "Publishes the project's draft to the public web at <subdomain>.openlen.app. The first time (and for a new address) it returns an approval_url: " +
    "the user approves it in their browser, then you call publish again with approval_id. Apps that don't compile are refused with the errors.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    subdomain: z
      .string()
      .optional()
      .describe("Needed the first time: lowercase letters, numbers and hyphens. Omit to republish at the current address."),
    approval_id: z.string().optional().describe("From a previous approval_required answer, once the user approved it."),
  }),
  annotations: PUBLISH_ANNOTATIONS,
  meta: { "anthropic/requiresUserInteraction": true },
  async run({ project_id, subdomain, approval_id }, caller) {
    const open = await openProject(caller, project_id, "editar");
    if (!open.ok) return open.result;
    const { acceso, row } = open;
    const target = (subdomain ?? row.subdomain ?? "").trim().toLowerCase();
    if (!target) return toolError("subdomain_required", "This project was never published: pass subdomain (lowercase letters, numbers and hyphens).");
    const valid = validateSubdomain(target);
    if (!valid.ok) return toolError("invalid_subdomain", `"${target}" is ${valid.reason}. Use lowercase letters, numbers and hyphens.`);
    if (acceso.rol !== "dueno" && row.subdomain !== valid.value) {
      return toolError("owner_only_address", `Only the owner can choose a new address; you can republish at ${row.subdomain ?? "its current address"}.`);
    }
    const req: ApprovalRequest = { userId: caller.userId, tokenId: caller.tokenId, projectId: project_id, action: "publish", subdomain: valid.value };
    // La confianza sólo vale si SIGUE publicado en esa dirección: tras
    // despublicar (aquí o en el editor), volver a publicar es reclamar la
    // dirección otra vez, y eso pide el OK de la persona.
    const trusted = row.subdomain === valid.value && (await hasTrustedPublish(req));
    const stop = await gate(req, approval_id, trusted);
    if (stop) return stop;
    // La revisión de seguridad (spec local 2026-10-15): lo grave frena, y
    // aceptarlo es del dueño en el diálogo de publicar, no de un agente de fuera.
    const security = await securityReviewer()
      .gate({ projectId: project_id, actorId: caller.userId, locale: "en" })
      .catch(() => ({ kind: "open" as const, view: null }));
    if (security.kind === "pending") return toolError("security_review_pending", "A security review of this project is still running. Call publish again in a minute.");
    if (security.kind === "blocked") return toolError("security_findings", agentBlockedText(security.view, ENDING_FOR_MCP));
    const denied = await consumeQuota(caller, "publish");
    if (denied) return denied;
    try {
      const r = await conAutor(caller.userId, () =>
        publishProject({ projectId: project_id, userId: acceso.duenoId, subdomain: valid.value, dataChanges: { mode: "system" } }),
      );
      if (approval_id) await markApprovalUsed(approval_id);
      return jsonResult({ status: "published", published_url: r.url, subdomain: r.subdomain, published_at: r.publishedAt.toISOString() });
    } catch (err) {
      return publishError(err, project_id);
    }
  },
});

export const unpublishTool = defineTool({
  name: "unpublish",
  title: "Unpublish",
  description:
    "Takes the project's published site offline (the draft stays). Owner only, and always with the user's approval: it returns an approval_url " +
    "the user approves in their browser, then you call unpublish again with approval_id.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    approval_id: z.string().optional(),
  }),
  annotations: PUBLISH_ANNOTATIONS,
  meta: { "anthropic/requiresUserInteraction": true },
  async run({ project_id, approval_id }, caller) {
    const open = await openProject(caller, project_id, "editar");
    if (!open.ok) return open.result;
    if (open.acceso.rol !== "dueno") return toolError("owner_only", "Only the owner can take the site offline.");
    if (!open.row.subdomain) return toolError("not_published", "This project isn't published.");
    const req: ApprovalRequest = {
      userId: caller.userId,
      tokenId: caller.tokenId,
      projectId: project_id,
      action: "unpublish",
      subdomain: open.row.subdomain,
    };
    const stop = await gate(req, approval_id, false);
    if (stop) return stop;
    await conAutor(caller.userId, () => unpublishProject({ projectId: project_id, userId: open.acceso.duenoId }));
    if (approval_id) await markApprovalUsed(approval_id);
    return jsonResult({ status: "unpublished" });
  },
});
