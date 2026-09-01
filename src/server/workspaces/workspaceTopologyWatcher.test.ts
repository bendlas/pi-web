import { describe, expect, it, vi } from "vitest";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import type { ProjectService } from "../projects/projectService.js";
import type { WorkspaceProviderAuthorityResolution } from "../../shared/apiTypes.js";
import type { WorkspaceProviderRegistry } from "./workspaceProviderRegistry.js";
import { WorkspaceTopologyWatcher } from "./workspaceTopologyWatcher.js";

interface FakeWorkspace {
  id: string;
  path: string;
  label: string;
  isMain: boolean;
}

function resolution(workspaces: FakeWorkspace[]): WorkspaceProviderAuthorityResolution {
  return { workspaces } as unknown as WorkspaceProviderAuthorityResolution;
}

function fakeWorkspace(id: string, label = id): FakeWorkspace {
  return { id, path: `/repo/${id}`, label, isMain: id === "main" };
}

describe("WorkspaceTopologyWatcher", () => {
  it("primes on the first pass and emits nothing for an already-known topology", async () => {
    const emitted: string[] = [];
    const catalog = { resolve: vi.fn((_project: { id: string }) => Promise.resolve(resolution([fakeWorkspace("main"), fakeWorkspace("feature")]))) };
    const projects = vi.fn(() => Promise.resolve([{ id: "p1" }, { id: "p2" }]));
    const eventHub = { publishGlobal: (event: { type: "workspaces.changed"; projectId: string }) => { emitted.push(event.projectId); } };
    const watcher = new WorkspaceTopologyWatcher({
      eventHub: eventHub as unknown as SessionEventHub,
      projects: { list: projects } as unknown as ProjectService,
      catalog: catalog as unknown as WorkspaceProviderRegistry,
      intervalMs: 100000,
    });

    await watcher.scan();
    await watcher.scan();

    expect(emitted).toEqual([]);
    expect(catalog.resolve).toHaveBeenCalledTimes(4);
  });

  it("emits workspaces.changed when a project's topology changes", async () => {
    const emitted: string[] = [];
    const topologies = new Map<string, WorkspaceProviderAuthorityResolution>([
      ["p1", resolution([fakeWorkspace("main"), fakeWorkspace("feature")])],
      ["p2", resolution([fakeWorkspace("main")])],
    ]);
    const catalog = { resolve: vi.fn((project: { id: string }) => Promise.resolve(topologies.get(project.id)!)) };
    const projects = vi.fn(() => Promise.resolve([{ id: "p1" }, { id: "p2" }]));
    const eventHub = { publishGlobal: (event: { type: "workspaces.changed"; projectId: string }) => { emitted.push(event.projectId); } };
    const watcher = new WorkspaceTopologyWatcher({
      eventHub: eventHub as unknown as SessionEventHub,
      projects: { list: projects } as unknown as ProjectService,
      catalog: catalog as unknown as WorkspaceProviderRegistry,
      intervalMs: 100000,
    });

    await watcher.scan();
    topologies.set("p1", resolution([fakeWorkspace("main"), fakeWorkspace("feature"), fakeWorkspace("extra")]));
    await watcher.scan();

    expect(emitted).toEqual(["p1"]);
  });

  it("drops the baseline for a project that disappears and emits nothing for it", async () => {
    const emitted: string[] = [];
    const topologies = new Map<string, WorkspaceProviderAuthorityResolution>([["p1", resolution([fakeWorkspace("main")])]]);
    const catalog = { resolve: vi.fn((project: { id: string }) => Promise.resolve(topologies.get(project.id)!)) };
    const projects = vi.fn(() => Promise.resolve([{ id: "p1" }]));
    const eventHub = { publishGlobal: (event: { type: "workspaces.changed"; projectId: string }) => { emitted.push(event.projectId); } };
    const watcher = new WorkspaceTopologyWatcher({
      eventHub: eventHub as unknown as SessionEventHub,
      projects: { list: projects } as unknown as ProjectService,
      catalog: catalog as unknown as WorkspaceProviderRegistry,
      intervalMs: 100000,
    });

    await watcher.scan();
    projects.mockResolvedValue([]);
    await watcher.scan();

    expect(emitted).toEqual([]);
  });

  it("skips a project whose resolution throws and keeps the previous baseline", async () => {
    const emitted: string[] = [];
    const topologies = new Map<string, WorkspaceProviderAuthorityResolution>([["p1", resolution([fakeWorkspace("main")])]]);
    const catalog = {
      resolve: vi.fn((project: { id: string }) => {
        if (project.id === "p1") return Promise.resolve(topologies.get(project.id)!);
        throw new Error("provider unavailable");
      }),
    };
    const projects = vi.fn(() => Promise.resolve([{ id: "p1" }, { id: "p2" }]));
    const eventHub = { publishGlobal: (event: { type: "workspaces.changed"; projectId: string }) => { emitted.push(event.projectId); } };
    const watcher = new WorkspaceTopologyWatcher({
      eventHub: eventHub as unknown as SessionEventHub,
      projects: { list: projects } as unknown as ProjectService,
      catalog: catalog as unknown as WorkspaceProviderRegistry,
      intervalMs: 100000,
    });

    await watcher.scan();
    topologies.set("p1", resolution([fakeWorkspace("main"), fakeWorkspace("feature")]));
    await watcher.scan();

    expect(emitted).toEqual(["p1"]);
  });
});
