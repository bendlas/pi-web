// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { Machine, Project, SessionInfo, Workspace } from "../../api";
import { machineStatusSnapshot } from "../../machineStatus.testSupport";
import { augmentStatusSnapshotWithUnread } from "../../statusUnreadProjection";
import { WorkspaceList } from "../WorkspaceList";
import { AppNavigationPanel } from "./AppNavigationPanel";

afterEach(() => {
  document.body.replaceChildren();
});

function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: "local",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}

function workspace(id: string, projectId: string, path: string): Workspace {
  return { id, projectId, path, label: id, isMain: true, effectiveConfig: {} };
}

function project(id: string): Project {
  return { id, name: id, path: `/repo/${id}`, createdAt: "2026-06-04T00:00:00.000Z" };
}

function session(id: string, cwd: string): SessionInfo {
  return { id, cwd, path: `${cwd}/${id}.jsonl`, created: "", modified: "", messageCount: 1, firstMessage: id };
}

function mount(panel: AppNavigationPanel): Promise<boolean> {
  document.body.append(panel);
  return panel.updateComplete;
}

async function panelFor(pinned: string[]): Promise<AppNavigationPanel> {
  const m = machine("m1");
  const workspaces = [workspace("ws-a", "p-a", "/repo/ws-a"), workspace("ws-b", "p-b", "/repo/ws-b")];
  const sessions = [session("sa", "/repo/ws-a"), session("sb", "/repo/ws-b")];
  const ownersBySession: Record<string, { workspaceId: string; projectId: string }> = {
    sa: { workspaceId: "ws-a", projectId: "p-a" },
    sb: { workspaceId: "ws-b", projectId: "p-b" },
  };
  const entries = pinned.map((id) => ownersBySession[id] ?? { workspaceId: "", projectId: "" });
  // PiWebApp rolls the keep-unread pins up into the status tree before handing it
  // to the panel; reproduce that here so the test exercises the pass-through.
  const raw = machineStatusSnapshot();
  const augmented = augmentStatusSnapshotWithUnread(raw, entries) ?? raw;
  const pinnedSet = new Set(pinned);
  const panel = new AppNavigationPanel();
  panel.machines = [m];
  panel.selectedMachine = m;
  panel.machineStatusSnapshots = { m1: augmented };
  panel.workspaces = workspaces;
  panel.projects = [project("p-a"), project("p-b")];
  panel.sessions = sessions;
  panel.keepUnreadSessionIds = pinnedSet;
  panel.unreadSessionIds = pinnedSet;
  await mount(panel);
  return panel;
}

function workspaceRow(panel: AppNavigationPanel, id: string): Element | null {
  const list = panel.shadowRoot?.querySelector<WorkspaceList>("workspace-list");
  const rows = [...(list?.shadowRoot?.querySelectorAll(".workspace-row") ?? [])];
  return rows.find((row) => row.textContent.includes(id)) ?? null;
}

describe("AppNavigationPanel keep-unread roll-up", () => {
  it("lights every pinned session's workspace and project, not only the selected one", async () => {
    const panel = await panelFor(["sa", "sb"]);
    const wsList = panel.shadowRoot?.querySelector<HTMLElement>("workspace-list");
    expect(wsList).not.toBeNull();
    const rowA = workspaceRow(panel, "ws-a");
    const rowB = workspaceRow(panel, "ws-b");
    expect(rowA?.querySelector(".activity-indicator.unread")).not.toBeNull();
    expect(rowB?.querySelector(".activity-indicator.unread")).not.toBeNull();
  });

  it("leaves workspaces of unpinned sessions dark", async () => {
    const panel = await panelFor(["sa"]);
    expect(workspaceRow(panel, "ws-a")?.querySelector(".activity-indicator.unread")).not.toBeNull();
    expect(workspaceRow(panel, "ws-b")?.querySelector(".activity-indicator.unread")).toBeNull();
  });
});
