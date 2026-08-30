import type { FastifyInstance } from "fastify";
import type { Workspace } from "../shared/apiTypes.js";
import {
  parseWorkspaceCreationRequest,
  WORKSPACE_CREATION_REQUEST_BODY_MAX_BYTES,
} from "../shared/workspaceCreationProtocol.js";
import { SessionDaemonClient, type SessionDaemonRequestOptions } from "../sessiond/sessionDaemonClient.js";
import { requestCancellation } from "./requestCancellation.js";
import type { ProjectService } from "./projects/projectService.js";
import type { PiWebConfigService } from "./configRoutes.js";
import { workspaceCreationHttpStatus } from "./workspaces/workspaceCreateService.js";
import { loadEffectiveProjectUploadsConfig } from "./workspaces/projectPiWebConfig.js";

export interface SessionProxyDaemon {
  request(
    method: string,
    path: string,
    body?: unknown,
    options?: SessionDaemonRequestOptions,
  ): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
}

export interface WorkspaceCreationRouteDependencies {
  projects: ProjectService;
  config?: Pick<PiWebConfigService, "read">;
}

/**
 * Browser-facing adapter; sessiond owns all workspace creation effects. The web
 * layer proxies the request and attaches the workspace-effective config the UI
 * needs, exactly like the workspace listing route.
 */
export function registerWorkspaceCreationRoutes(
  app: FastifyInstance,
  daemon: SessionProxyDaemon = new SessionDaemonClient(),
  deps: WorkspaceCreationRouteDependencies,
  prefix = "/api",
): void {
  app.post<{ Params: { projectId: string }; Body: unknown }>(
    `${prefix}/projects/:projectId/workspaces`,
    { bodyLimit: WORKSPACE_CREATION_REQUEST_BODY_MAX_BYTES },
    async (request, reply) => {
      let input: { name: string; baseRef?: string; branchName?: string };
      try {
        input = parseWorkspaceCreationRequest(request.body);
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }

      let projectPath: string;
      try {
        const project = await deps.projects.requireProject(request.params.projectId);
        projectPath = project.path;
      } catch (error) {
        const message = errorMessage(error);
        return reply.code(message === "Project not found" ? 404 : 500).send({ error: message });
      }

      const cancellation = requestCancellation(request, reply);
      try {
        const upstream = await daemon.request(
          "POST",
          `/workspace-creations/projects/${encodeURIComponent(request.params.projectId)}/workspaces`,
          input,
          { signal: cancellation.signal },
        );
        if (upstream.statusCode >= 400) {
          return await reply.code(upstream.statusCode).send(upstream.body === "" ? undefined : parseErrorBody(upstream.body));
        }
        const listing = parseListing(upstream.body);
        const effectiveConfig = await workspaceEffectiveConfig(projectPath, deps.config);
        return await reply.code(201).send({ ...listing, effectiveConfig });
      } catch (error) {
        return await reply.code(workspaceCreationHttpStatus(error)).send({ error: errorMessage(error) });
      } finally {
        cancellation.dispose();
      }
    },
  );
}

async function workspaceEffectiveConfig(projectPath: string, config?: Pick<PiWebConfigService, "read">): Promise<Workspace["effectiveConfig"]> {
  const globalConfig = config === undefined ? {} : (await config.read()).effectiveConfig;
  return { uploads: await loadEffectiveProjectUploadsConfig(projectPath, globalConfig) };
}

function parseListing(body: string): Record<string, unknown> {
  const value: unknown = JSON.parse(body);
  if (!isRecord(value) || typeof value["path"] !== "string") {
    throw new Error("Invalid workspace creation response");
  }
  return value;
}

function parseErrorBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
