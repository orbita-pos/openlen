// WHAT THE PERSON ANSWERED AND WHAT IT IS WORTH NOW (spec local 2026-11-27-notificaciones-del-escritorio, §4.4, §7.2 and
// §7.4). Pure and client-safe — it imports nothing server-only, and the one place that touches storage, `localGrantStore`,
// only ever runs where there is a `localStorage` — so the window (a client component) shares it with the server's types.
//   · an answer lives on the DEVICE, in the browser's `localStorage` of openlen.com, like Claude's
//     `artifact-app-permissions.json`: one key (`openlen:desktop-permissions`) holding a map
//     `person|installation|permission` → row. Every read and write is in a try/catch; with no storage (a private window, a
//     blocked one, the server) nothing is kept and everything is «prompt» again.
//   · a «no» is for good, whatever the version and the installation. A «yes» carries the `releaseSha` of the version the
//     window was showing and the `installedAt` of the installation, and is worth something only while BOTH are still the
//     window's — a new version, or a removal and reinstall (which renews `installedAt`), asks again.
//   · what the BROWSER says is never an answer of the app and is never stored here: the state combines the two, effective
//     = OpenLen's «yes» for this version and installation AND `Notification.permission === "granted"`.

import { GRANTABLE, type DesktopPermission } from "./declared";

export type PermissionState = "granted" | "denied" | "prompt" | "unavailable";

export type GrantRow = { answer: "granted"; releaseSha: string; installedAt: string } | { answer: "denied" };

export interface GrantStore {
  get(key: string): GrantRow | null;
  set(key: string, row: GrantRow): void;
  delete(key: string): void;
}

export const GRANTS_STORAGE_KEY = "openlen:desktop-permissions";

// A «yes» for another version or another installation than the window's: it no longer counts, and the dialog that asks
// again says why. A «no» and no answer at all are not a re-ask.
export function isReask(row: GrantRow | null, releaseSha: string, installedAt: string): boolean {
  return row?.answer === "granted" && (row.releaseSha !== releaseSha || row.installedAt !== installedAt);
}

export function grantKey(personId: string, installationId: string, permission: DesktopPermission): string {
  return `${personId}|${installationId}|${permission}`.toLowerCase();
}

export function permissionState(i: {
  permission: DesktopPermission;
  declared: readonly DesktopPermission[];
  switchOn: boolean;
  notificationsSupported: boolean;
  browser: NotificationPermission;
  row: GrantRow | null;
  releaseSha: string;
  installedAt: string;
}): PermissionState {
  if (!i.switchOn || !i.notificationsSupported) return "unavailable";
  if (!i.declared.includes(i.permission) || !GRANTABLE.includes(i.permission)) return "unavailable";
  if (i.row?.answer === "denied") return "denied";
  if (i.row?.answer === "granted" && !isReask(i.row, i.releaseSha, i.installedAt)) {
    if (i.browser === "granted") return "granted";
    // OpenLen said yes and the browser blocked them: the person must reactivate them in the browser.
    return i.browser === "denied" ? "denied" : "prompt";
  }
  return "prompt";
}

type Table = Record<string, unknown>;

// What is read back is checked: whatever else sits in the storage is not a row.
function toRow(value: unknown): GrantRow | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.answer === "denied") return { answer: "denied" };
  if (v.answer === "granted" && typeof v.releaseSha === "string" && typeof v.installedAt === "string") {
    return { answer: "granted", releaseSha: v.releaseSha, installedAt: v.installedAt };
  }
  return null;
}

function resolveStorage(given: Storage | undefined): Storage | null {
  if (given) return given;
  try {
    return typeof localStorage === "undefined" || localStorage === null ? null : localStorage;
  } catch {
    return null; // reading the global itself can throw (blocked site data)
  }
}

// A table with no prototype, so a key like `__proto__` is a key.
function readTable(storage: Storage): Table {
  const table: Table = Object.create(null);
  try {
    const raw = storage.getItem(GRANTS_STORAGE_KEY);
    if (!raw) return table;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) Object.assign(table, parsed);
  } catch {
    // an unreadable table is an empty one
  }
  return table;
}

function writeTable(storage: Storage, table: Table): void {
  try {
    if (Object.keys(table).length === 0) storage.removeItem(GRANTS_STORAGE_KEY);
    else storage.setItem(GRANTS_STORAGE_KEY, JSON.stringify(table));
  } catch {
    // full or blocked: the answer is lost and the person is asked again
  }
}

export function localGrantStore(storage?: Storage): GrantStore {
  return {
    get(key) {
      const store = resolveStorage(storage);
      if (!store) return null;
      const table = readTable(store);
      return Object.hasOwn(table, key) ? toRow(table[key]) : null;
    },
    set(key, row) {
      const store = resolveStorage(storage);
      const clean = toRow(row);
      if (!store || !clean) return;
      const table = readTable(store);
      table[key] = clean;
      writeTable(store, table);
    },
    delete(key) {
      const store = resolveStorage(storage);
      if (!store) return;
      const table = readTable(store);
      if (!Object.hasOwn(table, key)) return;
      delete table[key];
      writeTable(store, table);
    },
  };
}
