import { describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { Project, Workspace, WorkspaceProviderResolution } from "../api";
import { WorkspaceController, type WorkspaceControllerDependencies } from "./workspaceController";

type ControllerApi = NonNullable<WorkspaceControllerDependencies["api"]>;
type LoadWorkspaces = ControllerApi["workspaces"];

function workspace(id: string, label: string, isMain = false): Workspace {
  return { id, projectId: "p1", path: `/repo/${id}`, label, isMain, effectiveConfig: {} };
}

function project(id: string): Project {
  return { id, name: id, path: `/repo/${id}`, createdAt: "now" };
}

function apiFor(loadWorkspaces: LoadWorkspaces): ControllerApi {
  return {
    sessions: () => Promise.resolve([]),
    workspaces: loadWorkspaces,
    workspaceResolution: async (projectId, machineId, options): Promise<WorkspaceProviderResolution> => ({
      projectId,
      status: "provider",
      ownerPluginId: "git",
      diagnostics: [],
      workspaces: await loadWorkspaces(projectId, machineId, options),
    }),
  };
}

function controllerFor(
  getState: () => AppState,
  setState: (patch: Partial<AppState>) => void,
  api: ControllerApi,
): WorkspaceController {
  return new WorkspaceController(
    getState,
    setState,
    () => undefined,
    { clearActiveSession: () => undefined, preferredSession: () => undefined, selectSession: () => Promise.resolve() },
    undefined,
    { api, topologyRefreshDebounceMs: 0 },
  );
}

describe("WorkspaceController live events", () => {
  it("re-reads the workspace list on a workspaces.changed event for the selected project, preserving the selection", async () => {
    const refreshed: Workspace[] = [workspace("w1", "main", true), workspace("w2", "feature")];
    const workspaces = vi.fn<(projectId: string, machineId?: string) => Promise<Workspace[]>>(() => Promise.resolve(refreshed));
    let state: AppState = {
      ...initialAppState(),
      selectedProject: project("p1"),
      selectedWorkspace: workspace("w1", "main", true),
      workspaces: [workspace("w1", "main", true)],
    };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, apiFor(workspaces));

    controller.applyGlobalEvent({ type: "workspaces.changed", projectId: "p1" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(workspaces.mock.calls[0]?.[0]).toBe("p1");
    expect(state.workspaces.map((entry) => entry.id)).toEqual(["w1", "w2"]);
    expect(state.selectedWorkspace?.id).toBe("w1");
  });

  it("ignores workspaces.changed for a project the user is not viewing", async () => {
    const workspaces = vi.fn<(projectId: string, machineId?: string) => Promise<Workspace[]>>(() => Promise.resolve([]));
    let state: AppState = {
      ...initialAppState(),
      selectedProject: project("p1"),
      selectedWorkspace: workspace("w1", "main", true),
      workspaces: [workspace("w1", "main", true)],
    };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, apiFor(workspaces));

    controller.applyGlobalEvent({ type: "workspaces.changed", projectId: "p2" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(workspaces).not.toHaveBeenCalled();
  });

  it("does not churn the selected workspace identity when the refreshed topology is unchanged", async () => {
    const original = workspace("w1", "main", true);
    const workspaces = vi.fn<(projectId: string, machineId?: string) => Promise<Workspace[]>>(() => Promise.resolve([{ ...original }]));
    let state: AppState = {
      ...initialAppState(),
      selectedProject: project("p1"),
      selectedWorkspace: original,
      workspaces: [original],
    };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, apiFor(workspaces));

    const before = state.selectedWorkspace;
    controller.applyGlobalEvent({ type: "workspaces.changed", projectId: "p1" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.selectedWorkspace).toBe(before);
  });

  it("updates the selected workspace when a browser-visible field changed", async () => {
    const original = workspace("w1", "main", true);
    const relabeled = [workspace("w1", "renamed-branch", true)];
    const workspaces = vi.fn<(projectId: string, machineId?: string) => Promise<Workspace[]>>(() => Promise.resolve(relabeled));
    let state: AppState = {
      ...initialAppState(),
      selectedProject: project("p1"),
      selectedWorkspace: original,
      workspaces: [original],
    };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, apiFor(workspaces));

    const before = state.selectedWorkspace;
    controller.applyGlobalEvent({ type: "workspaces.changed", projectId: "p1" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.selectedWorkspace).not.toBe(before);
    expect(state.selectedWorkspace?.label).toBe("renamed-branch");
  });
});
