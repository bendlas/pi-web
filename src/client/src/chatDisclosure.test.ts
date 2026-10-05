import { describe, expect, it } from "vitest";
import { ChatDisclosureController, parseDisclosureSnapshot, type ChatDisclosureSnapshot, type ChatDisclosureStorage } from "./chatDisclosure";

class MemoryDisclosureStorage implements ChatDisclosureStorage {
  readonly snapshots = new Map<string, ChatDisclosureSnapshot>();

  read(sessionId: string): ChatDisclosureSnapshot | undefined {
    const snapshot = this.snapshots.get(sessionId);
    return snapshot === undefined ? undefined : cloneSnapshot(snapshot);
  }

  write(sessionId: string, snapshot: ChatDisclosureSnapshot): void {
    this.snapshots.set(sessionId, cloneSnapshot(snapshot));
  }
}

function cloneSnapshot(snapshot: ChatDisclosureSnapshot): ChatDisclosureSnapshot {
  return { open: [...snapshot.open], closedDefaultOpen: [...snapshot.closedDefaultOpen] };
}

describe("ChatDisclosureController", () => {
  it("keeps a default-open live group closed after the user closes it", () => {
    const storage = new MemoryDisclosureStorage();
    const controller = new ChatDisclosureController(storage);
    const key = "s1:live:12";

    controller.syncSession("s1");

    expect(controller.isOpen(key, true)).toBe(true);
    expect(controller.applyToggle(key, false, true)).toBe(true);
    expect(controller.isOpen(key, true)).toBe(false);
    expect(storage.read("s1")).toEqual({ open: [], closedDefaultOpen: [key] });
  });

  it("allows a closed default-open group to be reopened by the user", () => {
    const controller = new ChatDisclosureController(new MemoryDisclosureStorage());
    const key = "s1:live:12";

    controller.syncSession("s1");
    controller.applyToggle(key, false, true);

    expect(controller.applyToggle(key, true, true)).toBe(true);
    expect(controller.isOpen(key, true)).toBe(true);
    expect(controller.snapshot()).toEqual({ open: [], closedDefaultOpen: [] });
  });

  it("persists explicit opens for groups that are closed by default", () => {
    const storage = new MemoryDisclosureStorage();
    const key = "s1:44";

    const first = new ChatDisclosureController(storage);
    first.syncSession("s1");
    first.applyToggle(key, true, false);

    const second = new ChatDisclosureController(storage);
    second.syncSession("s1");

    expect(second.isOpen(key, false)).toBe(true);
  });

  it("keeps a marked-open key open when its default flips from open to closed", () => {
    const controller = new ChatDisclosureController(new MemoryDisclosureStorage());
    controller.syncSession("s1");
    const key = "s1:group:7";

    expect(controller.isOpen(key, true)).toBe(true);
    expect(controller.markOpen(key)).toBe(true);
    // The live-tail group finished: same key, now closed by default.
    expect(controller.isOpen(key, false)).toBe(true);
  });

  it("clears a user-pinned close when its key is marked open", () => {
    const controller = new ChatDisclosureController(new MemoryDisclosureStorage());
    controller.syncSession("s1");
    const key = "s1:group:7";

    controller.applyToggle(key, false, true);
    expect(controller.isOpen(key, true)).toBe(false);

    expect(controller.markOpen(key)).toBe(true);
    expect(controller.isOpen(key, true)).toBe(true);
  });

  it("reports no change when marking an already-open key", () => {
    const controller = new ChatDisclosureController(new MemoryDisclosureStorage());
    controller.syncSession("s1");
    const key = "s1:part:3:1";

    expect(controller.markOpen(key)).toBe(true);
    expect(controller.markOpen(key)).toBe(false);
  });
});

describe("parseDisclosureSnapshot", () => {
  it("hydrates legacy array storage as open group keys", () => {
    expect(parseDisclosureSnapshot(["a", 1, "b"])).toEqual({ open: ["a", "b"], closedDefaultOpen: [] });
  });

  it("hydrates object storage", () => {
    expect(parseDisclosureSnapshot({ open: ["a"], closedDefaultOpen: ["b", false] })).toEqual({ open: ["a"], closedDefaultOpen: ["b"] });
  });
});
