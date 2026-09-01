import type { FastifyInstance, FastifyReply } from "fastify";
import { loadGlobalTasksConfig } from "../globalTasksServer.js";

export interface GlobalTasksRouteDependencies {
  /** Resolved pi-web data dir (usually `piWebDataDir(env)`). */
  dataDir: string;
}

/**
 * Machine-wide scripts manifest endpoint, served from the browser-facing API
 * server (`buildApp` in `src/server/app.ts`) and also available on the session
 * daemon. Global scripts live in the data dir (outside any workspace root), so
 * they cannot be served through the workspace-scoped
 * `WorkspaceProviderRegistry.request` seam, which only reaches the plugin that
 * currently owns the workspace. This small dedicated route is therefore the
 * least-invasive channel that actually reaches a non-owning plugin's data.
 * The route name is retained for compatibility; it serves the Scripts panel.
 */
export function registerGlobalTasksRoutes(
  app: FastifyInstance,
  dependencies: GlobalTasksRouteDependencies,
  prefix = "/api/global-tasks",
): void {
  app.get(`${prefix}/config`, async (_request, reply: FastifyReply) => {
      const result = await loadGlobalTasksConfig(dependencies.dataDir);
      return reply.type("application/json; charset=utf-8").send(result);
    });
}
