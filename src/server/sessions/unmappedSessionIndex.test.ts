import { describe, expect, it } from "vitest";
import type { ClientSession } from "../types.js";
import { buildUnmappedSessionIndex } from "./unmappedSessionIndex.js";

describe("unmapped session index", () => {
  it("excludes sessions whose cwd a live workspace already exposes", () => {
    const index = build();

    expect(index.groups.map((group) => group.cwd)).toEqual(["/gone", "/repo-worktrees/gone"]);
    expect(index.groups.flatMap((group) => group.sessions.map((session) => session.id))).not.toContain("live");
  });

  it("classifies cwds under a workspace containment root as workspaces and the rest as projects", () => {
    const index = build();

    const byCwd = new Map(index.groups.map((group) => [group.cwd, group]));
    expect(byCwd.get("/gone")?.kind).toBe("project");
    expect(byCwd.get("/gone")?.projectId).toBeUndefined();
    expect(byCwd.get("/repo-worktrees/gone")?.kind).toBe("workspace");
    expect(byCwd.get("/repo-worktrees/gone")?.projectId).toBe("p-repo");
  });

  it("strips the matched root prefix from the workspace display path", () => {
    const index = build();

    const byCwd = new Map(index.groups.map((group) => [group.cwd, group]));
    expect(byCwd.get("/repo-worktrees/gone")?.relativePath).toBe("gone");
    expect(byCwd.get("/gone")?.relativePath).toBeUndefined();
  });

  it("attributes a workspace to the most specific overlapping containment root", () => {
    const index = buildUnmappedSessionIndex({
      sessions: [session("nested", "/outer/inner-worktrees/gone", "2026-04-01T00:00:00.000Z")],
      mappedWorkspaceCwds: [],
      workspaceContainmentRoots: [
        { projectId: "outer", path: "/outer" },
        { projectId: "inner", path: "/outer/inner" },
        { projectId: "inner", path: "/outer/inner-worktrees" },
      ],
      pathExists: () => false,
      now: new Date("2026-04-02T00:00:00.000Z"),
    });

    expect(index.groups[0]?.projectId).toBe("inner");
  });

  it("marks groups whose directory still exists as unmapped and the rest as deleted", () => {
    const index = build({ existing: new Set(["/gone"]) });

    const byCwd = new Map(index.groups.map((group) => [group.cwd, group]));
    expect(byCwd.get("/gone")?.exists).toBe(true);
    expect(byCwd.get("/repo-worktrees/gone")?.exists).toBe(false);
  });

  it("orders sessions newest first and keeps projects before workspaces", () => {
    const index = build({
      sessions: [
        session("worktree-old", "/repo-worktrees/gone", "2026-01-01T00:00:00.000Z"),
        session("project-old", "/gone", "2026-01-01T00:00:00.000Z"),
        session("project-new", "/gone", "2026-02-01T00:00:00.000Z"),
      ],
    });

    expect(index.groups.map((group) => group.cwd)).toEqual(["/gone", "/repo-worktrees/gone"]);
    expect(index.groups[0]?.sessions.map((session) => session.id)).toEqual(["project-new", "project-old"]);
  });

  it("keeps legacy sessions with an empty cwd so their history stays reachable", () => {
    const index = build({ sessions: [session("legacy", "", "2026-01-01T00:00:00.000Z")] });

    expect(index.groups).toHaveLength(1);
    expect(index.groups[0]).toMatchObject({ cwd: "", kind: "project", exists: false });
  });

  it("stamps generatedAt from the injected clock", () => {
    const index = build({ now: new Date("2026-03-01T12:00:00.000Z") });

    expect(index.generatedAt).toBe("2026-03-01T12:00:00.000Z");
  });
});

function build(overrides: {
  sessions?: ClientSession[];
  existing?: Set<string>;
  now?: Date;
} = {}) {
  const existing = overrides.existing ?? new Set<string>();
  return buildUnmappedSessionIndex({
    sessions: overrides.sessions ?? [
      session("live", "/repo", "2026-04-01T00:00:00.000Z"),
      session("gone-session", "/gone", "2026-04-01T00:00:00.000Z"),
      session("worktree-session", "/repo-worktrees/gone", "2026-04-01T00:00:00.000Z"),
    ],
    mappedWorkspaceCwds: ["/repo"],
    workspaceContainmentRoots: [
      { projectId: "p-repo", path: "/repo" },
      { projectId: "p-repo", path: "/repo-worktrees" },
    ],
    pathExists: (cwd) => existing.has(cwd),
    now: overrides.now ?? new Date("2026-04-02T00:00:00.000Z"),
  });
}

function session(id: string, cwd: string, modified: string): ClientSession {
  return {
    id,
    cwd,
    path: `/sessions/${id}.jsonl`,
    created: "2026-01-01T00:00:00.000Z",
    modified,
    messageCount: 1,
    firstMessage: "hello",
  };
}
