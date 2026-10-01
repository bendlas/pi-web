import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UnmappedSessionsResponse } from "../../shared/apiTypes.js";
import type { ClientSession, Project, WorkspaceListing } from "../types.js";
import { registerUnmappedSessionRoutes, type UnmappedSessionRouteDependencies } from "./unmappedSessionRoutes.js";

let app: FastifyInstance;

beforeEach(() => {
  app = Fastify({ logger: false });
});

afterEach(async () => {
  await app.close();
});

describe("session daemon unmapped session route", () => {
  it("groups sessions for cwds no live workspace exposes", async () => {
    registerUnmappedSessionRoutes(app, dependencies());

    const response = await app.inject({ method: "GET", url: "/sessions/unmapped" });

    expect(response.statusCode).toBe(200);
    const body = response.json<UnmappedSessionsResponse>();
    expect(body.generatedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(body.groups.map((group) => ({ cwd: group.cwd, kind: group.kind, exists: group.exists }))).toEqual([
      { cwd: "/gone", kind: "project", exists: false },
      { cwd: "/repo-worktrees/gone", kind: "workspace", exists: true },
    ]);
    expect(body.groups.flatMap((group) => group.sessions.map((session) => session.id))).not.toContain("live");
    expect(body.groups.flatMap((group) => group.sessions).every((session) => session.readOnly === true)).toBe(true);
  });

  it("keeps a project's sessions mapped when its workspace resolution fails", async () => {
    registerUnmappedSessionRoutes(app, dependencies({
      projects: [project("/repo")],
      workspaces: () => Promise.reject(new Error("provider down")),
      sessions: [session("live", "/repo"), session("gone", "/other")],
    }));

    const response = await app.inject({ method: "GET", url: "/sessions/unmapped" });

    expect(response.statusCode).toBe(200);
    expect(response.json<UnmappedSessionsResponse>().groups.map((group) => group.cwd)).toEqual(["/other"]);
  });

  it("answers 503 when the session listing fails", async () => {
    registerUnmappedSessionRoutes(app, dependencies({
      sessions: () => Promise.reject(new Error("store unavailable")),
    }));

    const response = await app.inject({ method: "GET", url: "/sessions/unmapped" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "Unmapped session index unavailable: store unavailable" });
  });
});

function dependencies(overrides: {
  sessions?: ClientSession[] | (() => Promise<ClientSession[]>);
  projects?: Project[];
  workspaces?: (project: Project) => Promise<WorkspaceListing[]>;
} = {}): UnmappedSessionRouteDependencies {
  const sessions = overrides.sessions ?? [
    session("live", "/repo"),
    session("gone", "/gone"),
    session("worktree", "/repo-worktrees/gone"),
  ];
  return {
    sessions: {
      listAllSessionsForIndex: typeof sessions === "function" ? sessions : () => Promise.resolve(sessions),
    },
    projects: { list: () => Promise.resolve(overrides.projects ?? [project("/repo")]) },
    workspaces: { list: overrides.workspaces ?? (() => Promise.resolve([workspace("/repo")])) },
    pathExists: (cwd) => cwd === "/repo-worktrees/gone",
    now: () => new Date("2026-05-01T00:00:00.000Z"),
  };
}

function session(id: string, cwd: string): ClientSession {
  return {
    id,
    cwd,
    path: `/sessions/${id}.jsonl`,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hello",
  };
}

function project(path: string): Project {
  return { id: `p-${path}`, name: "Project", path, createdAt: "2026-01-01T00:00:00.000Z" };
}

function workspace(path: string): WorkspaceListing {
  return { id: `w-${path}`, projectId: "p", path, label: "main", isMain: true };
}
