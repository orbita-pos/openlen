// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { grantKey, isReask, localGrantStore, permissionState, type GrantRow } from "./grants";
import type { DesktopPermission } from "./declared";

const RELEASE = "sha-this";
const INSTALLED = "2026-11-27T10:00:00.000Z";

const granted = (releaseSha = RELEASE, installedAt = INSTALLED): GrantRow => ({ answer: "granted", releaseSha, installedAt });
const denied: GrantRow = { answer: "denied" };

const input = (over: Partial<Parameters<typeof permissionState>[0]> = {}): Parameters<typeof permissionState>[0] => ({
  permission: "notifications",
  declared: ["notifications"],
  switchOn: true,
  notificationsSupported: true,
  browser: "default",
  row: null,
  releaseSha: RELEASE,
  installedAt: INSTALLED,
  ...over,
});

describe("permissionState", () => {
  it("is unavailable when the app did not declare it", () => {
    expect(permissionState(input({ declared: [], row: granted(), browser: "granted" }))).toBe("unavailable");
    expect(permissionState(input({ declared: ["shortcuts"], row: denied }))).toBe("unavailable");
  });

  it("is unavailable with the switch off, whatever was answered", () => {
    expect(permissionState(input({ switchOn: false, row: granted(), browser: "granted" }))).toBe("unavailable");
    expect(permissionState(input({ switchOn: false, row: denied }))).toBe("unavailable");
  });

  it("is unavailable where the browser cannot make a Notification", () => {
    expect(permissionState(input({ notificationsSupported: false, row: granted(), browser: "granted" }))).toBe("unavailable");
    expect(permissionState(input({ notificationsSupported: false, row: denied }))).toBe("unavailable");
  });

  it("is unavailable for a permission that cannot be granted, even declared and answered", () => {
    for (const permission of ["shortcuts", "overlay", "menu-bar", "full-access"] as DesktopPermission[]) {
      expect(permissionState(input({ permission, declared: [permission], row: granted(), browser: "granted" }))).toBe("unavailable");
    }
  });

  it("is prompt when the person was never asked", () => {
    expect(permissionState(input({ row: null, browser: "default" }))).toBe("prompt");
    expect(permissionState(input({ row: null, browser: "granted" }))).toBe("prompt");
    expect(permissionState(input({ row: null, browser: "denied" }))).toBe("prompt");
  });

  it("is denied after a no, whatever the version, the installation or the browser", () => {
    for (const browser of ["default", "granted", "denied"] as NotificationPermission[]) {
      expect(permissionState(input({ row: denied, browser }))).toBe("denied");
      expect(permissionState(input({ row: denied, browser, releaseSha: "sha-other", installedAt: "2030-01-01T00:00:00.000Z" }))).toBe("denied");
    }
  });

  it("is granted for a yes of this version and installation with the browser granted", () => {
    expect(permissionState(input({ row: granted(), browser: "granted" }))).toBe("granted");
  });

  it("is denied for a yes of this version when the browser blocked them", () => {
    expect(permissionState(input({ row: granted(), browser: "denied" }))).toBe("denied");
  });

  it("is prompt for a yes of this version when the browser has not been asked", () => {
    expect(permissionState(input({ row: granted(), browser: "default" }))).toBe("prompt");
  });

  it("is prompt for a yes of another version, whatever the browser says", () => {
    for (const browser of ["default", "granted", "denied"] as NotificationPermission[]) {
      expect(permissionState(input({ row: granted("sha-old"), browser }))).toBe("prompt");
    }
    expect(isReask(granted("sha-old"), RELEASE, INSTALLED)).toBe(true);
  });

  it("is prompt for a yes of another installation, whatever the browser says", () => {
    for (const browser of ["default", "granted", "denied"] as NotificationPermission[]) {
      expect(permissionState(input({ row: granted(RELEASE, "2026-11-01T00:00:00.000Z"), browser }))).toBe("prompt");
    }
    expect(isReask(granted(RELEASE, "2026-11-01T00:00:00.000Z"), RELEASE, INSTALLED)).toBe(true);
  });
});

describe("isReask", () => {
  it("is true only for a yes that is not this version and installation", () => {
    expect(isReask(null, RELEASE, INSTALLED)).toBe(false);
    expect(isReask(denied, RELEASE, INSTALLED)).toBe(false);
    expect(isReask(granted(), RELEASE, INSTALLED)).toBe(false);
    expect(isReask(granted("sha-old"), RELEASE, INSTALLED)).toBe(true);
    expect(isReask(granted(RELEASE, "2026-11-01T00:00:00.000Z"), RELEASE, INSTALLED)).toBe(true);
  });
});

describe("grantKey", () => {
  it("joins person, installation and permission, lowercase", () => {
    expect(grantKey("Person-1", "INSTALL-A", "notifications")).toBe("person-1|install-a|notifications");
    expect(grantKey("p", "i", "menu-bar")).toBe("p|i|menu-bar");
  });
});

function fakeStorage(initial: Record<string, string> = {}): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  };
}

const STORAGE_KEY = "openlen:desktop-permissions";

describe("localGrantStore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores rows under one key as a map", () => {
    const storage = fakeStorage();
    const store = localGrantStore(storage);
    store.set("a|b|notifications", granted());
    store.set("a|c|notifications", denied);
    expect(store.get("a|b|notifications")).toEqual(granted());
    expect(store.get("a|c|notifications")).toEqual(denied);
    expect(store.get("nobody|x|notifications")).toBeNull();
    expect([...storage.data.keys()]).toEqual([STORAGE_KEY]);
    expect(JSON.parse(storage.data.get(STORAGE_KEY)!)).toEqual({
      "a|b|notifications": granted(),
      "a|c|notifications": denied,
    });
  });

  it("keeps what another store wrote there and survives a new instance", () => {
    const storage = fakeStorage();
    localGrantStore(storage).set("k", denied);
    expect(localGrantStore(storage).get("k")).toEqual(denied);
  });

  it("replaces a row and deletes one without touching the others", () => {
    const storage = fakeStorage();
    const store = localGrantStore(storage);
    store.set("k1", denied);
    store.set("k2", granted());
    store.set("k1", granted("sha-new"));
    expect(store.get("k1")).toEqual(granted("sha-new"));
    store.delete("k1");
    expect(store.get("k1")).toBeNull();
    expect(store.get("k2")).toEqual(granted());
    store.delete("never-there");
    expect(store.get("k2")).toEqual(granted());
  });

  it("reads rows as they are, not as what a bad writer left", () => {
    const storage = fakeStorage({
      [STORAGE_KEY]: JSON.stringify({
        ok: { answer: "granted", releaseSha: "s", installedAt: "i", extra: 1 },
        no: { answer: "denied", releaseSha: "ignored" },
        noSha: { answer: "granted", installedAt: "i" },
        noInstalled: { answer: "granted", releaseSha: "s" },
        wrongType: { answer: "granted", releaseSha: 1, installedAt: "i" },
        other: { answer: "maybe" },
        nothing: null,
        text: "granted",
      }),
    });
    const store = localGrantStore(storage);
    expect(store.get("ok")).toEqual({ answer: "granted", releaseSha: "s", installedAt: "i" });
    expect(store.get("no")).toEqual({ answer: "denied" });
    for (const key of ["noSha", "noInstalled", "wrongType", "other", "nothing", "text", "constructor", "__proto__", "toString"]) {
      expect(store.get(key)).toBeNull();
    }
  });

  it("treats a corrupt value as empty and still writes", () => {
    for (const raw of ["not json", "[]", "null", "7", '"x"']) {
      const storage = fakeStorage({ [STORAGE_KEY]: raw });
      const store = localGrantStore(storage);
      expect(store.get("k")).toBeNull();
      store.delete("k");
      store.set("k", denied);
      expect(store.get("k")).toEqual(denied);
    }
  });

  it("never throws when the storage does", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    const store = localGrantStore({ ...fakeStorage(), getItem: boom, setItem: boom, removeItem: boom } as Storage);
    expect(() => store.set("k", denied)).not.toThrow();
    expect(() => store.delete("k")).not.toThrow();
    expect(store.get("k")).toBeNull();
  });

  it("works with no storage and stores nothing", () => {
    vi.stubGlobal("localStorage", undefined);
    const store = localGrantStore();
    expect(() => store.set("k", denied)).not.toThrow();
    expect(store.get("k")).toBeNull();
    expect(() => store.delete("k")).not.toThrow();
    expect(localGrantStore().get("k")).toBeNull();
  });

  it("works when reading the global localStorage throws", () => {
    vi.stubGlobal("localStorage", undefined);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    const store = localGrantStore();
    expect(() => store.set("k", denied)).not.toThrow();
    expect(store.get("k")).toBeNull();
  });

  it("uses the browser's localStorage when none is given", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    localGrantStore().set("k", denied);
    expect(localGrantStore().get("k")).toEqual(denied);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
  });
});
