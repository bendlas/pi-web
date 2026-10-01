import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerGlobalTasksRoutes } from "./globalTasksRoutes.js";

describe("global scripts routes", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "pi-global-scripts-route-"));
    await writeFile(
      join(dir, "scripts.json"),
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

  it("serves the data-dir scripts.json as a global-scripts config payload", async () => {
    const response = await app.inject({ method: "GET", url: "/api/global-tasks/config" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({
      kind: "loaded",
      config: { tasks: [{ id: "git.log-oneline" }] },
    });
  });

  it("serves a legacy tasks.json while migrating it", async () => {
    const legacyDir = await mkdtemp(join(tmpdir(), "pi-global-scripts-legacy-"));
    await writeFile(
      join(legacyDir, "tasks.json"),
      JSON.stringify({ version: 1, tasks: [{ id: "legacy.task", title: "Legacy", command: "true" }] }),
      "utf8",
    );
    const legacy = Fastify({ logger: false });
    registerGlobalTasksRoutes(legacy, { dataDir: legacyDir });
    await legacy.ready();
    const response = await legacy.inject({ method: "GET", url: "/api/global-tasks/config" });
    expect(response.json()).toMatchObject({ kind: "loaded", config: { tasks: [{ id: "legacy.task" }] } });
    await legacy.close();
    await rm(legacyDir, { recursive: true, force: true });
  });

  it("reports missing when the data dir has no scripts.json", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "pi-global-scripts-empty-"));
    const empty = Fastify({ logger: false });
    registerGlobalTasksRoutes(empty, { dataDir: emptyDir });
    await empty.ready();
    const response = await empty.inject({ method: "GET", url: "/api/global-tasks/config" });
    expect(response.json()).toMatchObject({ kind: "missing" });
    await empty.close();
    await rm(emptyDir, { recursive: true, force: true });
  });
});
