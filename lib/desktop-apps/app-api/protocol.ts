// THE LANGUAGE THE FRAME AND THE WINDOW SPEAK (spec local 2026-11-27-notificaciones-del-escritorio, §4.2): an app on the
// desktop, framed at its private `lienzo-…` label inside `/desktop/<id>`, gets `window.openlenApp` from a script OpenLen
// injects (`client-source.ts`); that script asks the window (openlen.com) by `postMessage`, and only the window decides.
// Pure and client-safe — the frame's script is a STRING built from `client-source.ts`, and the window (a client component)
// imports this file for the same names, types and validators.
//
//   request  { channel, id, method, args }                          frame → window
//   response { channel, id, ok: true, value } | { …, ok: false, code, message }   window → frame
//
// 🔴 The frame is the app's, so the window validates EVERYTHING a request carries with the validators below, whatever the
// frame's script does first: an app can post to its parent by hand. Errors are Claude's, in English (for code, not for the
// person): EPERM (not allowed / not declared), EINVAL (arguments), ENOTSUP (the window can't — not visible for a dialog,
// no window to ask).
import { DESKTOP_PERMISSIONS, type DesktopPermission } from "../permissions/declared";

export const APP_API_PATH = "/openlen-app.js";
export const APP_API_CHANNEL = "openlen-app/1";

export const APP_API_METHODS = ["permissions.state", "permissions.request", "permissions.manage", "notification.show"] as const;
export type AppApiMethod = (typeof APP_API_METHODS)[number];

export const APP_API_CODES = ["EPERM", "EINVAL", "ENOTSUP"] as const;
export type AppApiCode = (typeof APP_API_CODES)[number];

export type AppApiRequest = { channel: typeof APP_API_CHANNEL; id: string; method: AppApiMethod; args: unknown };
export type AppApiResponse =
  | { channel: typeof APP_API_CHANNEL; id: string; ok: true; value: unknown }
  | { channel: typeof APP_API_CHANNEL; id: string; ok: false; code: AppApiCode; message: string };

export type AppApiInvalid = { code: "EINVAL"; message: string };

/** `notification.show({ body })`: the body is 1 to 300 characters (UTF-16 units, as Claude's schema counts them). */
export const SHOW_BODY_MAX_CHARS = 300;
/** A request id is random and unguessable (a UUID, or 32 hex digits); the window takes anything up to this. */
export const REQUEST_ID_MAX_CHARS = 128;
/** The most names one `request()` may carry (there are five; repeats are dropped). */
export const REQUEST_MAX_NAMES = 32;

const invalid = (message: string): AppApiInvalid => ({ code: "EINVAL", message });

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

function isPermissionName(x: unknown): x is DesktopPermission {
  return typeof x === "string" && (DESKTOP_PERMISSIONS as readonly string[]).includes(x);
}

/** What the window takes from a frame: the channel, a string id, one of the four methods. `args` is checked by its method. */
export function isAppApiRequest(x: unknown): x is AppApiRequest {
  if (!isRecord(x)) return false;
  if (x.channel !== APP_API_CHANNEL) return false;
  if (typeof x.id !== "string" || x.id.length < 1 || x.id.length > REQUEST_ID_MAX_CHARS) return false;
  return typeof x.method === "string" && (APP_API_METHODS as readonly string[]).includes(x.method);
}

/** What the frame takes from the window: the channel, an id, and either `ok: true` or `ok: false` with a known code and a message. */
export function isAppApiResponse(x: unknown): x is AppApiResponse {
  if (!isRecord(x)) return false;
  if (x.channel !== APP_API_CHANNEL || typeof x.id !== "string") return false;
  if (x.ok === true) return true;
  return x.ok === false && typeof x.code === "string" && (APP_API_CODES as readonly string[]).includes(x.code) && typeof x.message === "string";
}

export const appApiOk = (id: string, value: unknown): AppApiResponse => ({ channel: APP_API_CHANNEL, id, ok: true, value });
export const appApiFail = (id: string, code: AppApiCode, message: string): AppApiResponse => ({ channel: APP_API_CHANNEL, id, ok: false, code, message });

/** The strict schema of `show`: EXACTLY `{ body }`, a string of 1 to 300 characters; any other key is an error, as Claude's. */
export function parseShowArgs(args: unknown): { body: string } | AppApiInvalid {
  if (!isRecord(args)) return invalid("notification.show takes an object: { body }");
  const keys = Object.keys(args);
  if (keys.length !== 1 || keys[0] !== "body") return invalid("notification.show takes only { body }");
  const body = args.body;
  if (typeof body !== "string") return invalid("body must be a string");
  if (body.length < 1 || body.length > SHOW_BODY_MAX_CHARS) return invalid(`body must be 1 to ${SHOW_BODY_MAX_CHARS} characters`);
  return { body };
}

/** `permissions.state(name?)`: no name asks for the whole map. */
export function parseStateArgs(args: unknown): { name: DesktopPermission | null } | AppApiInvalid {
  if (args === undefined) return { name: null };
  if (!isRecord(args)) return invalid("permissions.state takes { name? }");
  const keys = Object.keys(args);
  if (keys.some((k) => k !== "name")) return invalid("permissions.state takes only { name }");
  if (!has(args, "name") || args.name === undefined) return { name: null };
  if (!isPermissionName(args.name)) return invalid(`name must be one of ${DESKTOP_PERMISSIONS.join(", ")}`);
  return { name: args.name };
}

/** `permissions.request(names?)`: no names asks for everything the app declared. */
export function parseRequestArgs(args: unknown): { names: DesktopPermission[] | null } | AppApiInvalid {
  if (args === undefined) return { names: null };
  if (!isRecord(args)) return invalid("permissions.request takes { names? }");
  const keys = Object.keys(args);
  if (keys.some((k) => k !== "names")) return invalid("permissions.request takes only { names }");
  if (!has(args, "names") || args.names === undefined) return { names: null };
  const names = args.names;
  if (!Array.isArray(names) || names.length > REQUEST_MAX_NAMES) return invalid(`names must be a list of at most ${REQUEST_MAX_NAMES} permission names`);
  const out: DesktopPermission[] = [];
  for (const n of names) {
    if (!isPermissionName(n)) return invalid(`names must be among ${DESKTOP_PERMISSIONS.join(", ")}`);
    if (!out.includes(n)) out.push(n);
  }
  return { names: out };
}
