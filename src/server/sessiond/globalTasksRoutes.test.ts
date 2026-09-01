import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerGlobalTasksRoutes } from "./globalTasksRoutes.js";

describe("global tasks routes", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "pi-global-tasks-route-"));
    await writeFile(
      join(dir, "tasks.json"),
      JSON.stringify({ version: 1, tasks: [{ id: "git.log-oneline", title: "Git log", command: "git log --format=oneline" }] }),
      "utf8",
    );
    app = Fastify({ logger: false });
    registerGlobalTasksRoutes(app, { dataDir: dir });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("serves the data-dir tasks.json as a global-tasks config payload", async () => {
    const response = await app.inject({ method: "GET", url: "/api/global-tasks/config" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({
      kind: "loaded",
      config: { tasks: [{ id: "git.log-oneline" }] },
    });
  });

  it("reports missing when the data dir has no tasks.json", async () => {
    const empty = Fastify({ logger: false });
    registerGlobalTasksRoutes(empty, { dataDir: await mkdtemp(join(tmpdir(), "pi-global-tasks-empty-")) });
    await empty.ready();
    const response = await empty.inject({ method: "GET", url: "/api/global-tasks/config" });
    expect(response.json()).toMatchObject({ kind: "missing" });
    await empty.close();
  });
});
