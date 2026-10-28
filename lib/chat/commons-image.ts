/**
 * WHICH IMAGES OF LEN'S TEXT THE CHAT LOADS (spec local 2026-10-27-chat-drop-and-images, Part B).
 *
 * A remote image in the chat is a request from the person's browser to whoever the URL names, so
 * since A8 Len's `![…](…)` has been a link. The one exception is a photo `image_search` copied to
 * our storage: same-origin `/uploads/commons/…` with the filesystem storage, or `/commons/…` on our
 * static uploads host. The host check is what keeps a prompt-injected `![](https://evil/commons/…)`
 * a link. Pure: the chat and the credit route use it.
 */
import { OPENLEN_STATIC_HOSTS } from "@/lib/publish/base-host";

const FILE = /^commons\/[0-9a-f]{40}-\d+\.(?:jpg|png|webp|gif)$/;

export function isCommonsCopy(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return FILE.test(url.replace(/^\/uploads\//, ""));
  try {
    const u = new URL(url);
    return u.protocol === "https:" && OPENLEN_STATIC_HOSTS.includes(u.hostname) && !u.search && FILE.test(u.pathname.slice(1));
  } catch {
    return false;
  }
}

/** The credit `image_search` stored beside the photo. */
export function sidecarUrl(url: string): string {
  return url.replace(/\.(?:jpg|png|webp|gif)$/, ".json");
}

export interface CommonsCredit {
  readonly title: string;
  readonly author: string;
  readonly license: string;
  readonly licenseUrl: string | null;
  readonly pageUrl: string;
}

const httpUrl = (v: unknown): string | null => (typeof v === "string" && /^https?:\/\/\S+$/i.test(v) ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** A sidecar read as plain fields; null if it isn't one. */
export function creditFrom(v: unknown): CommonsCredit | null {
  const r = (v ?? {}) as Record<string, unknown>;
  const title = text(r.title, 200);
  const author = text(r.author, 200);
  const license = text(r.license, 80);
  const pageUrl = httpUrl(r.pageUrl);
  if (!title || !author || !license || !pageUrl) return null;
  return { title, author, license, licenseUrl: httpUrl(r.licenseUrl), pageUrl };
}
