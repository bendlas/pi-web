import { describe, expect, it } from "vitest";
import { CORE_STATUS_FLAGS, type MachineStatusSnapshot, type StatusFlags } from "../../shared/machineStatus";
import { augmentStatusSnapshotWithUnread } from "./statusUnreadProjection";
import type { SessionInfo, Workspace } from "./api";

function snapshot(flags: { machine?: StatusFlags; projects?: Record<string, StatusFlags>; workspaces?: Record<string, StatusFlags>; unattributed?: StatusFlags } = {}): MachineStatusSnapshot {
  return {
    epochId: "epoch",
    revision: 1,
    machine: flags.machine ?? {},
    projects: flags.projects ?? {},
    workspaces: flags.workspaces ?? {},
    unattributed: flags.unattributed ?? {},
    generatedAt: "2026-08-27T00:00:00.000Z",
  };
}

function workspace(id: string, projectId: string, path: string): Workspace {
  return { id, projectId, path, label: id, isMain: false, effectiveConfig: {} };
}

function session(id: string, cwd: string): SessionInfo {
  return { id, cwd, path: `${cwd}/${id}.jsonl`, created: "", modified: "", messageCount: 1, firstMessage: id };
}

const unread = CORE_STATUS_FLAGS.unread;

describe("statusUnreadProjection", () => {
  it("returns the snapshot untouched when no session is unread", () => {
    const base = snapshot({ workspaces: { ws: { [unread]: true } } });
    expect(augmentStatusSnapshotWithUnread(base, new Set(), [], [])).toBe(base);
  });

  it("ORs the unread flag into the owning workspace and project, leaving other nodes alone", () => {
    const base = snapshot({
      workspaces: { ws: {}, other: {} },
      projects: { p: {}, other: {} },
    });
    const next = augmentStatusSnapshotWithUnread(
      base,
      new Set(["pinned"]),
      [session("pinned", "/repo/work")],
      [workspace("ws", "p", "/repo"), workspace("other", "other", "/elsewhere")],
    );

    expect(next).not.toBe(base);
    expect(next?.workspaces["ws"]).toMatchObject({ [unread]: true });
    expect(next?.workspaces["other"]).toEqual({});
    expect(next?.projects["p"]).toMatchObject({ [unread]: true });
    expect(next?.projects["other"]).toEqual({});
    expect(next?.machine).toMatchObject({ [unread]: true });
  });

  it("attributes a pinned session to the deepest nested workspace", () => {
    const base = snapshot();
    const next = augmentStatusSnapshotWithUnread(
      base,
      new Set(["pinned"]),
      [session("pinned", "/repo/wt1/sub")],
      [workspace("parent", "p", "/repo"), workspace("nested", "p", "/repo/wt1")],
    );
    expect(next?.workspaces["nested"]).toMatchObject({ [unread]: true });
    // The unpinned parent workspace is absent from the tree, as the daemon only
    // emits nodes that carry a flag.
    expect(next?.workspaces["parent"]).toBeUndefined();
  });

  it("does not let /repo/wt1 claim /repo/wt10", () => {
    const base = snapshot();
    const next = augmentStatusSnapshotWithUnread(
      base,
      new Set(["pinned"]),
      [session("pinned", "/repo/wt10/work")],
      [workspace("wt1", "p", "/repo/wt1")],
    );
    expect(next?.workspaces["wt1"]).toBeUndefined();
    expect(next?.unattributed).toMatchObject({ [unread]: true });
  });

  it("rolls a pinned session with no owning workspace into the unattributed bucket", () => {
    const base = snapshot({ workspaces: { ws: { [unread]: true } } });
    const next = augmentStatusSnapshotWithUnread(
      base,
      new Set(["orphan"]),
      [session("orphan", "/nowhere")],
      [workspace("ws", "p", "/repo")],
    );
    expect(next).not.toBe(base);
    expect(next?.unattributed).toMatchObject({ [unread]: true });
  });

  it("preserves an existing unread flag from a real completion", () => {
    const base = snapshot({ workspaces: { ws: { [unread]: true, [CORE_STATUS_FLAGS.working]: true } } });
    const next = augmentStatusSnapshotWithUnread(
      base,
      new Set(["pinned"]),
      [session("pinned", "/repo/work")],
      [workspace("ws", "p", "/repo")],
    );
    expect(next?.workspaces["ws"]).toMatchObject({ [unread]: true, [CORE_STATUS_FLAGS.working]: true });
  });

  it("returns the snapshot unchanged when every owner is already flagged, so no spurious re-render", () => {
    const base = snapshot({
      machine: { [unread]: true },
      workspaces: { ws: { [unread]: true } },
      projects: { p: { [unread]: true } },
    });
    // A session in ws is unread via the daemon; passing it through the same
    // roll-up must not allocate a new snapshot or change any flag.
    const next = augmentStatusSnapshotWithUnread(
      base,
      new Set(["daemon-unread"]),
      [session("daemon-unread", "/repo/work")],
      [workspace("ws", "p", "/repo")],
    );
    expect(next).toBe(base);
  });

  it("derives the same workspace badge from a keep-unread pin as from a daemon-unread session", () => {
    const base = snapshot();
    const fromPin = augmentStatusSnapshotWithUnread(
      base,
      new Set(["pinned"]),
      [session("pinned", "/repo/work")],
      [workspace("ws", "p", "/repo")],
    );
    const fromDaemon = augmentStatusSnapshotWithUnread(
      base,
      new Set(["completed"]),
      [session("completed", "/repo/work")],
      [workspace("ws", "p", "/repo")],
    );
    expect(fromPin?.workspaces["ws"]).toMatchObject({ [unread]: true });
    expect(fromDaemon?.workspaces["ws"]).toEqual(fromPin?.workspaces["ws"]);
  });
});
