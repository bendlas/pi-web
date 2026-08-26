import { describe, expect, it } from "vitest";
import { loadKeepUnreadIds, setKeepUnread } from "./keepUnreadSessions";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("keep-unread sessions", () => {
  it("persists pinned sessions per machine and reloads them", () => {
    const storage = new MemoryStorage();

    setKeepUnread("local", "alpha", true, storage);
    setKeepUnread("local", "beta", true, storage);
    setKeepUnread("remote", "alpha", true, storage);

    expect([...loadKeepUnreadIds("local", storage)]).toEqual(["alpha", "beta"]);
    expect([...loadKeepUnreadIds("remote", storage)]).toEqual(["alpha"]);
    expect([...loadKeepUnreadIds("other", storage)]).toEqual([]);
  });

  it("removes a session when it is unpinned, leaving other machines untouched", () => {
    const storage = new MemoryStorage();
    setKeepUnread("local", "alpha", true, storage);
    setKeepUnread("remote", "alpha", true, storage);

    setKeepUnread("local", "alpha", false, storage);

    expect([...loadKeepUnreadIds("local", storage)]).toEqual([]);
    expect([...loadKeepUnreadIds("remote", storage)]).toEqual(["alpha"]);
  });

  it("keeps pinning idempotent and drops the stored payload once nothing is pinned", () => {
    const storage = new MemoryStorage();

    setKeepUnread("local", "alpha", true, storage);
    setKeepUnread("local", "alpha", true, storage);
    expect([...loadKeepUnreadIds("local", storage)]).toEqual(["alpha"]);

    setKeepUnread("local", "alpha", false, storage);
    setKeepUnread("local", "alpha", false, storage);
    expect(storage.length).toBe(0);
  });

  it("treats unreadable or malformed storage as nothing pinned", () => {
    const storage = new MemoryStorage();
    storage.setItem("pi-web.keep-unread.v1", "{oops");
    expect([...loadKeepUnreadIds("local", storage)]).toEqual([]);

    storage.setItem("pi-web.keep-unread.v1", JSON.stringify({ local: ["alpha", 7, "alpha"], remote: "beta" }));
    expect([...loadKeepUnreadIds("local", storage)]).toEqual(["alpha"]);
    expect([...loadKeepUnreadIds("remote", storage)]).toEqual([]);

    // A pin still lands on top of a partially unusable payload.
    setKeepUnread("local", "beta", true, storage);
    expect([...loadKeepUnreadIds("local", storage)]).toEqual(["alpha", "beta"]);
  });

  it("ignores storage that throws instead of failing the caller", () => {
    const throwing: Storage = {
      length: 0,
      clear: () => undefined,
      key: () => null,
      getItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };

    expect(() => { setKeepUnread("local", "alpha", true, throwing); }).not.toThrow();
    expect([...loadKeepUnreadIds("local", throwing)]).toEqual([]);
  });

  it("reports nothing pinned when the browser has no storage at all", () => {
    expect([...loadKeepUnreadIds("local", undefined)]).toEqual([]);
    expect(() => { setKeepUnread("local", "alpha", true, undefined); }).not.toThrow();
  });
});
