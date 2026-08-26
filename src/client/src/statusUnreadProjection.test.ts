import { describe, expect, it } from "vitest";
import { CORE_STATUS_FLAGS, type MachineStatusSnapshot, type StatusFlags } from "../../shared/machineStatus";
import { attributeCwd, augmentStatusSnapshotWithUnread, reconcileVisibleUnread } from "./statusUnreadProjection";
import type { Workspace } from "./api";

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

const unread = CORE_STATUS_FLAGS.unread;

describe("augmentStatusSnapshotWithUnread", () => {
  it("returns the snapshot untouched when no pin is kept unread", () => {
    const base = snapshot({ workspaces: { ws: { [unread]: true } } });
    expect(augmentStatusSnapshotWithUnread(base, [])).toBe(base);
  });

  it("ORs the unread flag into the owning workspace and project, leaving other nodes alone", () => {
    const base = snapshot({
      workspaces: { ws: {}, other: {} },
      projects: { p: {}, other: {} },
    });
    const next = augmentStatusSnapshotWithUnread(base, [{ workspaceId: "ws", projectId: "p" }]);

    expect(next).not.toBe(base);
    expect(next?.workspaces["ws"]).toMatchObject({ [unread]: true });
    expect(next?.workspaces["other"]).toEqual({});
    expect(next?.projects["p"]).toMatchObject({ [unread]: true });
    expect(next?.projects["other"]).toEqual({});
    expect(next?.machine).toMatchObject({ [unread]: true });
  });

  it("does not light a workspace the pin does not belong to, even if it shares a project", () => {
    const base = snapshot({ workspaces: { ws: {}, sibling: {} }, projects: { p: {} } });
    const next = augmentStatusSnapshotWithUnread(base, [{ workspaceId: "ws", projectId: "p" }]);
    expect(next?.workspaces["ws"]).toMatchObject({ [unread]: true });
    expect(next?.workspaces["sibling"]).toEqual({});
  });

  it("preserves an existing unread flag from a real completion", () => {
    const base = snapshot({ workspaces: { ws: { [unread]: true, [CORE_STATUS_FLAGS.working]: true } } });
    const next = augmentStatusSnapshotWithUnread(base, [{ workspaceId: "ws", projectId: "p" }]);
    expect(next?.workspaces["ws"]).toMatchObject({ [unread]: true, [CORE_STATUS_FLAGS.working]: true });
  });

  it("returns the snapshot unchanged when every owner is already flagged, so no spurious re-render", () => {
    const base = snapshot({
      machine: { [unread]: true },
      workspaces: { ws: { [unread]: true } },
      projects: { p: { [unread]: true } },
    });
    const next = augmentStatusSnapshotWithUnread(base, [{ workspaceId: "ws", projectId: "p" }]);
    expect(next).toBe(base);
  });

  it("adds the node even when the snapshot's tree does not yet contain it", () => {
    const base = snapshot();
    const next = augmentStatusSnapshotWithUnread(base, [{ workspaceId: "ws", projectId: "p" }]);
    expect(next?.workspaces["ws"]).toMatchObject({ [unread]: true });
    expect(next?.projects["p"]).toMatchObject({ [unread]: true });
  });
});

describe("reconcileVisibleUnread", () => {
  const workspacesByProjectId = { p: [{ id: "ws", projectId: "p" }, { id: "sibling", projectId: "p" }] };

  it("returns the snapshot untouched when the selected workspace is justified by a visible unread session", () => {
    const base = snapshot({ workspaces: { ws: { [unread]: true } }, projects: { p: { [unread]: true } }, machine: { [unread]: true } });
    const next = reconcileVisibleUnread(base, "ws", workspacesByProjectId, true);
    expect(next).toBe(base);
  });

  it("returns the snapshot untouched when there is no selected workspace", () => {
    const base = snapshot({ workspaces: { ws: { [unread]: true } } });
    const next = reconcileVisibleUnread(base, "", workspacesByProjectId, false);
    expect(next).toBe(base);
  });

  it("suppresses the selected workspace, its project, and the machine when an orphaned daemon unread has no visible session", () => {
    const base = snapshot({
      workspaces: { ws: { [unread]: true }, sibling: {} },
      projects: { p: { [unread]: true } },
      machine: { [unread]: true },
    });
    const next = reconcileVisibleUnread(base, "ws", workspacesByProjectId, false);
    expect(next).not.toBe(base);
    expect(next?.workspaces["ws"]).not.toMatchObject({ [unread]: true });
    expect(next?.workspaces["sibling"]).toEqual({});
    expect(next?.projects["p"]).not.toMatchObject({ [unread]: true });
    expect(next?.machine).not.toMatchObject({ [unread]: true });
  });

  it("keeps the project and machine lit when a sibling workspace still carries unread", () => {
    const base = snapshot({
      workspaces: { ws: { [unread]: true }, sibling: { [unread]: true } },
      projects: { p: { [unread]: true } },
      machine: { [unread]: true },
    });
    const next = reconcileVisibleUnread(base, "ws", workspacesByProjectId, false);
    expect(next?.workspaces["ws"]).not.toMatchObject({ [unread]: true });
    expect(next?.workspaces["sibling"]).toMatchObject({ [unread]: true });
    expect(next?.projects["p"]).toMatchObject({ [unread]: true });
    expect(next?.machine).toMatchObject({ [unread]: true });
  });

  it("leaves the workspace lit when a keep-unread pin justifies it even without a visible session", () => {
    const base = snapshot({ workspaces: { ws: { [unread]: true } }, projects: { p: { [unread]: true } }, machine: { [unread]: true } });
    const next = reconcileVisibleUnread(base, "ws", workspacesByProjectId, true);
    expect(next).toBe(base);
  });
});

describe("attributeCwd", () => {
  it("resolves a cwd to the deepest nested workspace", () => {
    const workspaces = [workspace("parent", "p", "/repo"), workspace("nested", "p", "/repo/wt1")];
    expect(attributeCwd("/repo/wt1/sub", workspaces)).toEqual({ workspaceId: "nested", projectId: "p" });
    expect(attributeCwd("/repo/wt1", workspaces)).toEqual({ workspaceId: "nested", projectId: "p" });
    expect(attributeCwd("/repo", workspaces)).toEqual({ workspaceId: "parent", projectId: "p" });
  });

  it("does not let /repo/wt1 claim /repo/wt10", () => {
    const workspaces = [workspace("wt1", "p", "/repo/wt1")];
    expect(attributeCwd("/repo/wt10/work", workspaces)).toBeUndefined();
    expect(attributeCwd("/repo/wt1/work", workspaces)).toEqual({ workspaceId: "wt1", projectId: "p" });
  });

  it("returns undefined when no workspace contains the cwd", () => {
    const workspaces = [workspace("ws", "p", "/repo")];
    expect(attributeCwd("/nowhere", workspaces)).toBeUndefined();
  });
});
