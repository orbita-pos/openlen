// THE FILES LEN PRESENTED, AS AN EMAIL CARRIES THEM: a scheduled task's result (lib/scheduled-tasks/deliver.ts)
// and Len's reply by email (lib/len-email/run.ts). What fits goes attached, up to `MAX_ATTACHMENT_BYTES` for the
// whole email, like `present`'s cap on one file; the rest goes as a link to the project's route, which checks
// access. Only the files `present` stored (`deliveredFrom`, the project's own route): never another page.
import { deliveredFrom, type DeliveredFile } from "./present";

/** What one email carries, like `present`'s cap on one file. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface PresentedAttachments {
  readonly attachments: { filename: string; content: Buffer }[];
  /** `name: url` for each file that did not fit, for the email's text. */
  readonly links: string[];
}

/** The private-store key behind a delivered file's URL (`deliverableLocation` in present.ts), if it is this
 *  project's delivery route. */
function deliveryKey(projectId: string, url: string): string | null {
  const m = /^\/api\/projects\/([^/]+)\/deliveries\/([^/]+)\/([^/]+)$/.exec(url);
  if (!m || decodeURIComponent(m[1]!) !== projectId) return null;
  return `deliveries/${projectId}/${m[2]}/${decodeURIComponent(m[3]!)}`;
}

export async function presentedAttachments(
  projectId: string,
  cards: readonly { readonly tool?: unknown; readonly delivered?: unknown }[],
  readDelivery: (key: string) => Promise<Uint8Array | null>,
  siteUrl: string,
): Promise<PresentedAttachments> {
  const files: DeliveredFile[] = cards.filter((c) => c.tool === "present").flatMap((c) => deliveredFrom(c.delivered) ?? []);
  const attachments: { filename: string; content: Buffer }[] = [];
  const links: string[] = [];
  let total = 0;
  for (const file of files) {
    const key = deliveryKey(projectId, file.url);
    const bytes = key && total + file.size <= MAX_ATTACHMENT_BYTES ? await readDelivery(key) : null;
    if (bytes && total + bytes.byteLength <= MAX_ATTACHMENT_BYTES) {
      attachments.push({ filename: file.name, content: Buffer.from(bytes) });
      total += bytes.byteLength;
    } else {
      links.push(`${file.name}: ${siteUrl}${file.url}`);
    }
  }
  return { attachments, links };
}
