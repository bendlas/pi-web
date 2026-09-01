import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPiSessionManagerGateway, defaultPiSessionDir } from "./piSessionManagerGateway.js";
import { PiSessionService } from "./piSessionService.js";
import type { PiSessionManager, PiSessionManagerGateway } from "./piSessionService.js";
import { CapturingSessionEventHub, testModelRuntime } from "./piSessionService.testSupport.js";

let tempDir: string;
let agentDir: string;
let cwd: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-session-name-test-"));
  agentDir = join(tempDir, "agent");
  cwd = join(tempDir, "workspace");
  await mkdir(cwd, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeNamedSession(sessionDir: string, id: string, sessionCwd: string, name?: string): Promise<string> {
  await mkdir(sessionDir, { recursive: true });
  const filePath = join(sessionDir, `${id}.jsonl`);
  const lines = [
    JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: sessionCwd }),
  ];
  if (name !== undefined) {
    lines.push(JSON.stringify({ type: "session_info", timestamp: "2026-01-01T00:00:01.000Z", name }));
  }
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

async function appendSessionInfo(filePath: string, name?: string): Promise<void> {
  const entry = name === undefined
    ? { type: "session_info", timestamp: "2026-01-01T00:00:02.000Z" }
    : { type: "session_info", timestamp: "2026-01-01T00:00:02.000Z", name };
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function nameEvents(hub: CapturingSessionEventHub): Array<{ sessionId: string; name?: string }> {
  return hub.globalEvents
    .filter((event): event is Extract<typeof event, { type: "session.name" }> => event.type === "session.name")
    .map((event) => ({ sessionId: event.sessionId, ...("name" in event ? { name: event.name } : {}) }));
}

describe("PiSessionService session.name detection", () => {
  it("emits session.name when a session_info name is appended outside the daemon", async () => {
    const sessionDir = defaultPiSessionDir(cwd, agentDir);
    const filePath = await writeNamedSession(sessionDir, "session-1", cwd, "Original");
    const gateway = createPiSessionManagerGateway({ agentDir, env: {} });
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir,
      modelRuntime: testModelRuntime,
      sessionManager: gateway,
      heartbeatIntervalMs: 600_000,
    });

    // First pass primes the cache without emitting.
    await (service as unknown as { detectSessionNameChanges(): Promise<void> }).detectSessionNameChanges();
    expect(nameEvents(hub)).toHaveLength(0);

    // An external writer appends a session_info entry with a new name.
    await appendSessionInfo(filePath, "Renamed externally");
    await (service as unknown as { detectSessionNameChanges(): Promise<void> }).detectSessionNameChanges();

    expect(nameEvents(hub)).toEqual([{ sessionId: "session-1", name: "Renamed externally" }]);

    await service.dispose();
  });

  it("emits a name-less session.name when the appended session_info clears the name", async () => {
    const sessionDir = defaultPiSessionDir(cwd, agentDir);
    const filePath = await writeNamedSession(sessionDir, "session-2", cwd, "Original");
    const gateway = createPiSessionManagerGateway({ agentDir, env: {} });
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir,
      modelRuntime: testModelRuntime,
      sessionManager: gateway,
      heartbeatIntervalMs: 600_000,
    });

    await (service as unknown as { detectSessionNameChanges(): Promise<void> }).detectSessionNameChanges();
    expect(nameEvents(hub)).toHaveLength(0);

    await appendSessionInfo(filePath, "");
    await (service as unknown as { detectSessionNameChanges(): Promise<void> }).detectSessionNameChanges();

    expect(nameEvents(hub)).toEqual([{ sessionId: "session-2" }]);

    await service.dispose();
  });

  it("does not emit session.name when the name is unchanged", async () => {
    const sessionDir = defaultPiSessionDir(cwd, agentDir);
    await writeNamedSession(sessionDir, "session-3", cwd, "Stable");
    const gateway = createPiSessionManagerGateway({ agentDir, env: {} });
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir,
      modelRuntime: testModelRuntime,
      sessionManager: gateway,
      heartbeatIntervalMs: 600_000,
    });

    await (service as unknown as { detectSessionNameChanges(): Promise<void> }).detectSessionNameChanges();
    await (service as unknown as { detectSessionNameChanges(): Promise<void> }).detectSessionNameChanges();

    expect(nameEvents(hub)).toHaveLength(0);

    await service.dispose();
  });

  it("coalesces overlapping name scans so listAll is not re-enumerated concurrently", async () => {
    let listAllCalls = 0;
    let inflight = 0;
    let maxInflight = 0;
    const baseGateway = createPiSessionManagerGateway({ agentDir, env: {} });
    const sessionManager = {
      ...baseGateway,
      listAll: async () => {
        listAllCalls += 1;
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inflight -= 1;
        return baseGateway.listAll();
      },
    } as unknown as PiSessionManagerGateway;
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir,
      modelRuntime: testModelRuntime,
      sessionManager,
      heartbeatIntervalMs: 600_000,
    });
    const detect = () => (service as unknown as { detectSessionNameChanges(): Promise<void> }).detectSessionNameChanges();
    // The 2s heartbeat fire-and-forgets detectSessionNameChanges; if listAll is slow, ticks would
    // otherwise overlap and re-enumerate every session concurrently. Fire several at once.
    await Promise.all([detect(), detect(), detect(), detect(), detect()]);
    expect(maxInflight).toBe(1);
    expect(listAllCalls).toBe(1);
    await service.dispose();
  });

  it("re-reads only the changed file (not the whole store) on a watch-detected rename", async () => {
    const sessionDir = defaultPiSessionDir(cwd, agentDir);
    const filePath = await writeNamedSession(sessionDir, "session-watch", cwd, "Original");
    const gateway = createPiSessionManagerGateway({ agentDir, env: {} });
    const listAllSpy = vi.spyOn(gateway, "listAll");
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir,
      modelRuntime: testModelRuntime,
      sessionManager: gateway,
      heartbeatIntervalMs: 600_000,
    });

    // Prime via the full scan (the startup path), then simulate a watch event
    // for the one file that changed.
    await (service as unknown as { detectSessionNameChanges(): Promise<void> }).detectSessionNameChanges();
    expect(nameEvents(hub)).toHaveLength(0);
    listAllSpy.mockClear();

    await appendSessionInfo(filePath, "Renamed by watch");
    await (service as unknown as { detectSessionNameChangeForFile(path: string): Promise<void> }).detectSessionNameChangeForFile(filePath);

    expect(nameEvents(hub)).toEqual([{ sessionId: "session-watch", name: "Renamed by watch" }]);
    // The efficient path re-reads only the changed file; it must not re-enumerate the store.
    expect(listAllSpy).not.toHaveBeenCalled();
  });
});
