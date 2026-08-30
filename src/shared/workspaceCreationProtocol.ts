import type { CreateWorkspaceRequest } from "./apiTypes.js";

/** Small JSON request naming the new worktree and optional base/branch. */
export const WORKSPACE_CREATION_REQUEST_BODY_MAX_BYTES = 4 * 1024;
/** One sessiond-owned deadline across owner resolution and provider creation. */
export const WORKSPACE_CREATION_OPERATION_TIMEOUT_MS = 25_000;
/** Leaves time for cancellation to reach remote web/sessiond before gateway timeout. */
export const WORKSPACE_CREATION_FEDERATION_TIMEOUT_MS = 30_000;
export const WORKSPACE_CREATION_NAME_MAX_LENGTH = 128;

export function parseWorkspaceCreationRequest(value: unknown): CreateWorkspaceRequest {
  if (!isRecord(value)) throw new Error("Workspace creation request must be an object");
  const name = requireNonEmptyString(value["name"], "name");
  const baseRef = optionalString(value["baseRef"], "baseRef");
  const branchName = optionalString(value["branchName"], "branchName");
  return {
    name,
    ...(baseRef === undefined ? {} : { baseRef }),
    ...(branchName === undefined ? {} : { branchName }),
  };
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Workspace creation ${field} must be a non-empty string`);
  }
  if (value.length > WORKSPACE_CREATION_NAME_MAX_LENGTH) {
    throw new Error(`Workspace creation ${field} must be at most ${String(WORKSPACE_CREATION_NAME_MAX_LENGTH)} characters`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Workspace creation ${field} must be a string`);
  if (value === "") return undefined;
  if (value.length > WORKSPACE_CREATION_NAME_MAX_LENGTH) {
    throw new Error(`Workspace creation ${field} must be at most ${String(WORKSPACE_CREATION_NAME_MAX_LENGTH)} characters`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
