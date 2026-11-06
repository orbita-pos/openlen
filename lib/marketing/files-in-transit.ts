"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE FILES SENT FROM THE HOME (Jesús, 06/11: «el input de /new tiene attach files y el de / no; sólo debe haber un
// input y debe ser el que tenga todo»).
//
// The home's box takes what /new's takes — photos AND files (PDF, video…) —, but a file can't ride in a URL, and
// `sessionStorage` (where the photos and the first message cross, `lib/referencia-en-transito.ts`,
// `first-message-in-transit.ts`) holds a few MB of text, not a 20 MB video. IndexedDB keeps `File` objects as they
// are, so the files wait there, and what says WHICH ones are this tab's is a one-use pass in `sessionStorage`: the
// same lifetime as the first message — it survives the sign-in detour in this tab, dies with the tab, goes stale after
// 30 minutes, and is spent when /new reads it (or when the visitor closes the sign-in dialog).
//
// The pass and the store are apart on purpose: the rules (one use, this tab, fresh) are plain code tested with an
// in-memory store, and IndexedDB is only where the bytes sit. Every access is guarded: a private window, blocked site
// data or a missing IndexedDB only means the files don't cross — the message still goes, as it did before.
// ─────────────────────────────────────────────────────────────────────────────

import { FIRST_MESSAGE_TTL_MS } from "./first-message-in-transit";

const PASS_KEY = "openlen:files-in-transit";

/** What waits in the store under a pass's id. */
export interface FilesRecord {
  readonly at: number;
  readonly files: readonly File[];
}

/** Where the bytes sit: IndexedDB in the browser, a Map in the tests. */
export interface FilesStore {
  put(id: string, record: FilesRecord): Promise<void>;
  get(id: string): Promise<FilesRecord | undefined>;
  delete(id: string): Promise<void>;
  /** Removes every record left before `before` (passes lost with a closed tab). */
  prune(before: number): Promise<void>;
}

interface Pass {
  id: string;
  at: number;
}

function readPass(session: Storage): Pass | null {
  try {
    const raw = session.getItem(PASS_KEY);
    if (!raw) return null;
    const pass = JSON.parse(raw) as Partial<Pass>;
    return typeof pass.id === "string" && typeof pass.at === "number" ? { id: pass.id, at: pass.at } : null;
  } catch {
    return null;
  }
}

function forgetPass(session: Storage): void {
  try {
    session.removeItem(PASS_KEY);
  } catch {
    /* nothing to forget */
  }
}

/** The rules of the pass, over any store. */
export function filesInTransit(store: () => FilesStore | null, session: () => Storage | null = () => sessionStorage) {
  const sessionOrNull = () => {
    try {
      return session();
    } catch {
      return null;
    }
  };

  /** Drops this tab's files: the pass and what it points at. */
  const drop = async (): Promise<void> => {
    const s = sessionOrNull();
    if (!s) return;
    const pass = readPass(s);
    forgetPass(s);
    const st = store();
    if (pass && st) await st.delete(pass.id).catch(() => {});
  };

  /** Leaves the files just before going to /new (or opening the sign-in dialog). Empty = drops what was there.
   *  `false` if they couldn't be kept (no storage): the caller goes on with the message alone. */
  const leave = async (files: readonly File[], now: number = Date.now()): Promise<boolean> => {
    await drop();
    if (files.length === 0) return true;
    const s = sessionOrNull();
    const st = store();
    if (!s || !st) return false;
    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await st.prune(now - FIRST_MESSAGE_TTL_MS).catch(() => {});
      await st.put(id, { at: now, files: [...files] });
      s.setItem(PASS_KEY, JSON.stringify({ id, at: now } satisfies Pass));
      return true;
    } catch {
      await st.delete(id).catch(() => {});
      return false;
    }
  };

  /** Reads AND SPENDS this tab's files: only if the pass is here and fresh. */
  const take = async (now: number = Date.now()): Promise<File[]> => {
    const s = sessionOrNull();
    if (!s) return [];
    const pass = readPass(s);
    forgetPass(s);
    if (!pass) return [];
    const st = store();
    if (!st) return [];
    try {
      const record = await st.get(pass.id);
      await st.delete(pass.id);
      if (!record || now - pass.at > FIRST_MESSAGE_TTL_MS) return [];
      return record.files.filter((f): f is File => typeof File !== "undefined" && f instanceof File);
    } catch {
      return [];
    }
  };

  return { leave, take, drop };
}

// ─── IndexedDB, where the bytes sit in the browser ─────────────────────────────

const DB_NAME = "openlen-transit";
const STORE_NAME = "files";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE_NAME)) open.result.createObjectStore(STORE_NAME);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("blocked"));
  }).catch((e: unknown) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

async function inStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return request(fn(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)));
}

const indexedDbStore: FilesStore = {
  put: async (id, record) => void (await inStore("readwrite", (s) => s.put(record, id))),
  get: (id) => inStore<FilesRecord | undefined>("readonly", (s) => s.get(id) as IDBRequest<FilesRecord | undefined>),
  delete: async (id) => void (await inStore("readwrite", (s) => s.delete(id))),
  prune: async (before) => {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const cursor = tx.objectStore(STORE_NAME).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        if (((c.value as FilesRecord | undefined)?.at ?? 0) < before) c.delete();
        c.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

const browser = filesInTransit(() => (typeof indexedDB === "undefined" ? null : indexedDbStore));

/** The home: leave the box's files for /new, just before going. */
export const leaveFilesInTransit = browser.leave;
/** /new: take (and spend) what the home left, when it sends the first message. */
export const takeFilesInTransit = browser.take;
/** The visitor closed the sign-in dialog, or took a file out of the box: what was left is not on its way any more. */
export const dropFilesInTransit = browser.drop;
