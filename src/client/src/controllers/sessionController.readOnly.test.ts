import { describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { InMemorySessionSelectionMemory } from "./sessionSelection";
import { emptyPage, emptyTranscriptApi as defaultApi, FakeSocket, workspace, type AppState } from "./sessionController.testSupport";

const readOnlySession: SessionInfo = {
  id: "unmapped-session",
  path: "/sessions/unmapped-session.jsonl",
  cwd: "/deleted/repo",
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-01-02T00:00:00.000Z",
  messageCount: 2,
  firstMessage: "an old conversation",
  readOnly: true,
};

function controllerFor(state: () => AppState, setState: (patch: Partial<AppState>) => void, api: typeof defaultApi, socket: FakeSocket): SessionController {
  return new SessionController(
    state,
    setState,
    () => undefined,
    new InMemorySessionSelectionMemory(),
    { api, socket },
  );
}

describe("SessionController read-only sessions", () => {
  it("loads messages without opening a live socket or status for unmapped history", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const messages = vi.fn().mockResolvedValue(emptyPage);
    const socket = new FakeSocket();
    const controller = controllerFor(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { ...defaultApi, messages },
      socket,
    );

    await controller.selectSession(readOnlySession, { updateUrl: false });

    expect(state.selectedSession).toEqual(readOnlySession);
    expect(messages).toHaveBeenCalledTimes(1);
    expect(socket.connectedSessionIds).toEqual([]);
    expect(state.status).toBeUndefined();
  });

  it("refuses to send prompts for a read-only session", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: readOnlySession, sessions: [] };
    const prompt = vi.fn().mockResolvedValue(undefined);
    const controller = controllerFor(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      { ...defaultApi, prompt },
      new FakeSocket(),
    );

    await controller.send("hello");

    expect(prompt).not.toHaveBeenCalled();
  });
});
