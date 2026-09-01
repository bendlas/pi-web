import { describe, expect, it } from "vitest";
import { loadKeepUnreadEntries, loadKeepUnreadIds, reconcileKeepUnreadEntries, setKeepUnread, type KeepUnreadEntry, type KeepUnreadReconcileContext } from "./keepUnreadSessions";

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

/** A pin with only an id; the nav roll-up tests cover ownership, this file only ids. */
function pin(id: string): KeepUnreadEntry {
  return { id, cwd: "", workspaceId: "", projectId: "" };
}

describe("keep-unread sessions", () => {
  it("persists pinned sessions per machine and reloads them", () => {
    const storage = new MemoryStorage();

    setKeepUnread("local", pin("alpha"), true, storage);
    setKeepUnread("local", pin("beta"), true, storage);
    setKeepUnread("remote", pin("alpha"), true, storage);

    expect([...loadKeepUnreadIds("local", storage)]).toEqual(["alpha", "beta"]);
    expect([...loadKeepUnreadIds("remote", storage)]).toEqual(["alpha"]);
    expect([...loadKeepUnreadIds("other", storage)]).toEqual([]);
  });

  it("removes a session when it is unpinned, leaving other machines untouched", () => {
    const storage = new MemoryStorage();
    setKeepUnread("local", pin("alpha"), true, storage);
    setKeepUnread("remote", pin("alpha"), true, storage);

    setKeepUnread("local", pin("alpha"), false, storage);

    expect([...loadKeepUnreadIds("local", storage)]).toEqual([]);
    expect([...loadKeepUnreadIds("remote", storage)]).toEqual(["alpha"]);
  });

  it("keeps pinning idempotent and drops the stored payload once nothing is pinned", () => {
    const storage = new MemoryStorage();

    setKeepUnread("local", pin("alpha"), true, storage);
    setKeepUnread("local", pin("alpha"), true, storage);
    expect([...loadKeepUnreadIds("local", storage)]).toEqual(["alpha"]);

    setKeepUnread("local", pin("alpha"), false, storage);
    setKeepUnread("local", pin("alpha"), false, storage);
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
    setKeepUnread("local", pin("beta"), true, storage);
    expect([...loadKeepUnreadIds("local", storage)]).toEqual(["alpha", "beta"]);
  });

  it("loads legacy id-only pins without ownership so the row marker still restores", () => {
    const storage = new MemoryStorage();
    storage.setItem("pi-web.keep-unread.v1", JSON.stringify({ local: ["alpha", "beta"] }));
    expect([...loadKeepUnreadIds("local", storage)]).toEqual(["alpha", "beta"]);
    expect(loadKeepUnreadEntries("local", storage)).toEqual([
      { id: "alpha", cwd: "", workspaceId: "", projectId: "" },
      { id: "beta", cwd: "", workspaceId: "", projectId: "" },
    ]);
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

    expect(() => { setKeepUnread("local", pin("alpha"), true, throwing); }).not.toThrow();
    expect([...loadKeepUnreadIds("local", throwing)]).toEqual([]);
  });

  it("reports nothing pinned when the browser has no storage at all", () => {
    expect([...loadKeepUnreadIds("local", undefined)]).toEqual([]);
    expect(() => { setKeepUnread("local", pin("alpha"), true, undefined); }).not.toThrow();
  });
});

/** A pin carrying the ownership the nav roll-up needs, in addition to the bare id. */
function owned(id: string, workspaceId: string, projectId: string): KeepUnreadEntry {
  return { id, cwd: "/repo", workspaceId, projectId };
}

describe("reconcileKeepUnreadEntries", () => {
  const baseContext = (overrides: Partial<KeepUnreadReconcileContext> = {}): KeepUnreadReconcileContext => ({
    liveWorkspaceIds: new Set(["ws-1", "ws-2"]),
    selectedWorkspaceId: "ws-1",
    selectedWorkspaceSessionIds: new Set(["alpha", "beta"]),
    selectedWorkspaceArchivedIds: new Set(),
    deletedSessionIds: new Set(),
    ...overrides,
  });

  it("keeps every pin when the topology is unchanged and nothing was deleted", () => {
    const entries = [owned("alpha", "ws-1", "proj-1"), pin("beta")];
    expect(reconcileKeepUnreadEntries(entries, baseContext())).toEqual(entries);
  });

  it("drops pins whose workspace was removed", () => {
    const orphan = owned("alpha", "ws-gone", "proj-1");
    const live = owned("beta", "ws-1", "proj-1");
    const kept = reconcileKeepUnreadEntries([orphan, live], baseContext());
    expect(kept).toEqual([live]);
  });

  it("drops pins for sessions the user explicitly deleted, across any workspace", () => {
    const gone = owned("alpha", "ws-1", "proj-1");
    const live = owned("beta", "ws-2", "proj-2");
    const kept = reconcileKeepUnreadEntries([gone, live], baseContext({ deletedSessionIds: new Set(["alpha"]) }));
    expect(kept).toEqual([live]);
  });

  it("drops a pin whose session was archived in the selected workspace", () => {
    const archived = owned("alpha", "ws-1", "proj-1");
    const live = owned("beta", "ws-1", "proj-1");
    const kept = reconcileKeepUnreadEntries(
      [archived, live],
      baseContext({ selectedWorkspaceSessionIds: new Set(["alpha", "beta"]), selectedWorkspaceArchivedIds: new Set(["alpha"]) }),
    );
    expect(kept).toEqual([live]);
  });

  it("drops a pin whose session vanished from the selected workspace list", () => {
    const gone = owned("alpha", "ws-1", "proj-1");
    const live = owned("beta", "ws-1", "proj-1");
    const kept = reconcileKeepUnreadEntries(
      [gone, live],
      baseContext({ selectedWorkspaceSessionIds: new Set(["beta"]) }),
    );
    expect(kept).toEqual([live]);
  });

  it("never infers deletion from a momentarily empty selected-workspace list", () => {
    const pinned = owned("alpha", "ws-1", "proj-1");
    expect(reconcileKeepUnreadEntries([pinned], baseContext({ selectedWorkspaceSessionIds: new Set() })))
      .toEqual([pinned]);
  });

  it("keeps pins for unloaded workspaces even when their session is absent here", () => {
    // The client cannot see ws-2's sessions, so a pin there survives: the
    // keep-unread feature lights badges across workspaces.
    const other = owned("gamma", "ws-2", "proj-2");
    expect(reconcileKeepUnreadEntries([other], baseContext({ selectedWorkspaceSessionIds: new Set(["beta"]) })))
      .toEqual([other]);
  });

  it("never drops a legacy id-only pin unless its session was deleted", () => {
    // Legacy pins carry no workspace, so a removed workspace must not prune them.
    const legacy = pin("beta");
    expect(reconcileKeepUnreadEntries([legacy], baseContext({ liveWorkspaceIds: new Set() }))).toEqual([legacy]);
    expect(reconcileKeepUnreadEntries([legacy], baseContext({ deletedSessionIds: new Set(["beta"]) }))).toEqual([]);
  });
});
