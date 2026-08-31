import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { piWebDataDir } from "../../config.js";
import type { PendingAskUser } from "../../shared/apiTypes.js";

export const PENDING_ASK_STATE_VERSION = 1;
const PENDING_ASK_FILE_MODE = 0o600;

/** One open ask on disk, bound to the session that posted it. */
export interface PendingAskPersistedEntry {
  sessionId: string;
  ask: PendingAskUser;
}

/** The durable shape of all open asks, written as a single file per daemon instance. */
export interface PendingAskPersistedState {
  version: typeof PENDING_ASK_STATE_VERSION;
  asks: PendingAskPersistedEntry[];
}

/**
 * Read/write seam for daemon-owned open-ask state. The store owns the in-memory
 * map and serializes it through this adapter; a persistent implementation lets
 * an open ask survive a session daemon reload instead of vanishing with the
 * daemon's heap.
 */
export interface PendingAskPersistence {
  load(): Promise<unknown>;
  save(state: PendingAskPersistedState): Promise<void>;
}

class PendingAskPersistenceCorruptionError extends Error {
  constructor(cause: unknown) {
    super("Session pending ask persistence contains invalid JSON", { cause });
  }
}

/** File-backed {@link PendingAskPersistence} with atomic writes, mirroring the unread store. */
export class FileSessionPendingAskPersistence implements PendingAskPersistence {
  constructor(readonly filePath = defaultSessionPendingAskFilePath()) {}

  async load(): Promise<unknown> {
    let source: string;
    try {
      source = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    }
    try {
      return JSON.parse(source);
    } catch (error: unknown) {
      throw new PendingAskPersistenceCorruptionError(error);
    }
  }

  async save(state: PendingAskPersistedState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid.toString()}-${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        mode: PENDING_ASK_FILE_MODE,
        flag: "wx",
      });
      await rename(tempPath, this.filePath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}

export function defaultSessionPendingAskFilePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "session-pending-asks.json");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
