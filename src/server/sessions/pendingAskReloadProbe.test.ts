import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { PendingAskStore } from "./pendingAskStore.js";
import { FileSessionPendingAskPersistence } from "./pendingAskPersistence.js";
import {
  CapturingSessionEventHub,
  emptyArchiveStore,
  fakeRuntime,
  runtimeCreator,
  sessionGateway,
  sessionRecord,
  sessionRef,
  testModelRuntime,
} from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
const ACTIVE_SESSION_ID = "session-1";

const questions = [{ id: "db", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] }];

function askService(filePath: string) {
  const store = new PendingAskStore({
    now: () => new Date("2026-02-01T10:00:00.000Z"),
    createAskId: (() => {
      let next = 0;
      return () => {
        next += 1;
        return `ask-${next.toString()}`;
      };
    })(),
    persistence: new FileSessionPendingAskPersistence(filePath),
  });
  const fake = fakeRuntime(ACTIVE_SESSION_ID);
  const events = new CapturingSessionEventHub();
  const service = new PiSessionService(events, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    sessionManager: sessionGateway([sessionRecord(ACTIVE_SESSION_ID)]),
    archiveStore: emptyArchiveStore(),
    createAgentRuntime: runtimeCreator(fake.runtime),
    pendingAskStore: store,
    askUserEnabled: true,
    heartbeatIntervalMs: 60_000,
  });
  return { service, store, events };
}

describe("ask_user across a service restart (disk rehydration)", () => {
  it("rehydrates the open ask from disk after the service restarts", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-ask-"));
    const filePath = join(root, "session-pending-asks.json");

    const first = askService(filePath);
    await first.store.load();
    const opened = await first.service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the persist flush

    const beforeReload = await first.service.status(sessionRef(ACTIVE_SESSION_ID));
    expect(beforeReload.pendingAsk).toMatchObject({ askId: opened.ask.askId });
    await first.service.dispose();

    const second = askService(filePath);
    await second.store.load();
    const afterReload = await second.service.status(sessionRef(ACTIVE_SESSION_ID));
    expect(afterReload.pendingAsk).toMatchObject({ askId: opened.ask.askId });
    await second.service.dispose();
  });
});
