import { describe, expect, it, vi } from "vitest";
import type { WorkspaceProviderAuthorityResolution } from "../../shared/apiTypes.js";
import type { Project } from "../types.js";
import { WorkspaceTopologyWatcher, type WorkspaceTopologyWatcherOptions } from "./workspaceTopologyWatcher.js";

interface FakeWorkspace {
  id: string;
  projectId: string;
  path: string;
  label: string;
  isMain: boolean;
}

function resolution(workspaces: FakeWorkspace[]): WorkspaceProviderAuthorityResolution {
  return { projectId: "p1", status: "provider", diagnostics: [], workspaces };
}

function fakeWorkspace(id: string, label = id): FakeWorkspace {
  return { id, projectId: "p1", path: `/repo/${id}`, label, isMain: id === "main" };
}

function project(id: string): Project {
  return { id, name: id, path: `/repo/${id}`, createdAt: "now" };
}

function projectIds(ids: readonly string[]): Project[] {
  return ids.map((id) => project(id));
}

interface EmittedEvents {
  projectIds: string[];
  publishGlobal: (event: { type: "workspaces.changed"; projectId: string }) => void;
}

function emittedEvents(): EmittedEvents {
  const projectIds: string[] = [];
  return { projectIds, publishGlobal: (event) => { projectIds.push(event.projectId); } };
}

function topologyFor(
  known: Map<string, WorkspaceProviderAuthorityResolution>,
  id: string,
): WorkspaceProviderAuthorityResolution {
  const resolutionOfProject = known.get(id);
  if (resolutionOfProject === undefined) throw new Error(`No topology fixture for project ${id}`);
  return resolutionOfProject;
}

function watcherWith(
  options: {
    catalog: WorkspaceTopologyWatcherOptions["catalog"];
    projects: WorkspaceTopologyWatcherOptions["projects"];
    eventHub: WorkspaceTopologyWatcherOptions["eventHub"];
    intervalMs?: number;
  },
): WorkspaceTopologyWatcher {
  return new WorkspaceTopologyWatcher({
    eventHub: options.eventHub,
    projects: options.projects,
    catalog: options.catalog,
    intervalMs: options.intervalMs ?? 100000,
  });
}

describe("WorkspaceTopologyWatcher", () => {
  it("primes on the first pass and emits nothing for an already-known topology", async () => {
    const emitted = emittedEvents();
    const catalog = { resolve: vi.fn(() => Promise.resolve(resolution([fakeWorkspace("main"), fakeWorkspace("feature")]))) };
    const projects = vi.fn(() => Promise.resolve(projectIds(["p1", "p2"])));
    const watcher = watcherWith({ eventHub: emitted, projects: { list: projects }, catalog });

    await watcher.scan();
    await watcher.scan();

    expect(emitted.projectIds).toEqual([]);
    expect(catalog.resolve).toHaveBeenCalledTimes(4);
  });

  it("emits workspaces.changed when a project's topology changes", async () => {
    const emitted = emittedEvents();
    const topologies = new Map<string, WorkspaceProviderAuthorityResolution>([
      ["p1", resolution([fakeWorkspace("main"), fakeWorkspace("feature")])],
      ["p2", resolution([fakeWorkspace("main")])],
    ]);
    const catalog = { resolve: vi.fn((input: Project) => Promise.resolve(topologyFor(topologies, input.id))) };
    const projects = vi.fn(() => Promise.resolve(projectIds(["p1", "p2"])));
    const watcher = watcherWith({ eventHub: emitted, projects: { list: projects }, catalog });

    await watcher.scan();
    topologies.set("p1", resolution([fakeWorkspace("main"), fakeWorkspace("feature"), fakeWorkspace("extra")]));
    await watcher.scan();

    expect(emitted.projectIds).toEqual(["p1"]);
  });

  it("drops the baseline for a project that disappears and emits nothing for it", async () => {
    const emitted = emittedEvents();
    const topologies = new Map<string, WorkspaceProviderAuthorityResolution>([["p1", resolution([fakeWorkspace("main")])]]);
    const catalog = { resolve: vi.fn((input: Project) => Promise.resolve(topologyFor(topologies, input.id))) };
    const projects = vi.fn(() => Promise.resolve(projectIds(["p1"])));
    const watcher = watcherWith({ eventHub: emitted, projects: { list: projects }, catalog });

    await watcher.scan();
    projects.mockResolvedValue([]);
    await watcher.scan();

    expect(emitted.projectIds).toEqual([]);
  });

  it("skips a project whose resolution throws and keeps the previous baseline", async () => {
    const emitted = emittedEvents();
    const topologies = new Map<string, WorkspaceProviderAuthorityResolution>([["p1", resolution([fakeWorkspace("main")])]]);
    const catalog = {
      resolve: vi.fn((input: Project) => {
        if (input.id === "p1") return Promise.resolve(topologyFor(topologies, input.id));
        throw new Error("provider unavailable");
      }),
    };
    const projects = vi.fn(() => Promise.resolve(projectIds(["p1", "p2"])));
    const watcher = watcherWith({ eventHub: emitted, projects: { list: projects }, catalog });

    await watcher.scan();
    topologies.set("p1", resolution([fakeWorkspace("main"), fakeWorkspace("feature")]));
    await watcher.scan();

    expect(emitted.projectIds).toEqual(["p1"]);
  });

  it("never runs overlapping scans when the interval is shorter than a single scan", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const catalog = {
      resolve: vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 30));
        inFlight -= 1;
        return resolution([fakeWorkspace("main"), fakeWorkspace("feature")]);
      }),
    };
    const projects = vi.fn(() => Promise.resolve(projectIds(["p1", "p2", "p3"])));
    const watcher = watcherWith({ eventHub: emittedEvents(), projects: { list: projects }, catalog, intervalMs: 5 });

    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    watcher.stop();

    // A resolution pass that outlasts the poll interval must not let setInterval
    // stack more passes on top of it: at most one scan (and thus one resolve)
    // may be in flight at any moment.
    expect(maxInFlight).toBe(1);
    // The interval is now a cheap, resolve-free project-set reconcile; the only
    // resolves are the initial prime (one per known project), not a periodic sweep.
    expect(catalog.resolve).toHaveBeenCalledTimes(3);
  });

  it("coalesces overlapping per-project rescans triggered by file-watch events", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const catalog = {
      resolve: vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 30));
        inFlight -= 1;
        return resolution([fakeWorkspace("main"), fakeWorkspace("feature")]);
      }),
    };
    const projects = vi.fn(() => Promise.resolve(projectIds(["p1"])));
    const watcher = watcherWith({ eventHub: emittedEvents(), projects: { list: projects }, catalog });
    await watcher.scan();
    // A burst of git fs events for the same project must not stack rescans on top
    // of each other: the per-project guard makes all but the first a no-op.
    await Promise.all(Array.from({ length: 20 }, () => watcher.scanProject(project("p1"))));
    expect(maxInFlight).toBe(1);
  });
});
