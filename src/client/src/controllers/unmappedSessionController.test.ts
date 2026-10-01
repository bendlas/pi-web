import { describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { UnmappedSessionGroup } from "../api";
import { HttpRequestError } from "../api/http";
import { browserErrorScopeKey, machineBrowserErrorScope } from "../browserErrors";
import { UnmappedSessionController } from "./unmappedSessionController";

const groups: UnmappedSessionGroup[] = [{
  cwd: "/gone",
  kind: "project",
  exists: false,
  sessions: [{
    id: "s1",
    cwd: "/gone",
    path: "/sessions/s1.jsonl",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    messageCount: 2,
    firstMessage: "hello",
    readOnly: true,
  }],
}];

describe("UnmappedSessionController", () => {
  it("stores the groups returned for the selected machine", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const controller = new UnmappedSessionController(
      () => state,
      setState,
      { api: { unmappedSessions: vi.fn().mockResolvedValue({ generatedAt: "now", groups }) } },
    );

    await controller.load();

    expect(state.unmappedGroups).toEqual(groups);
  });

  it("reports a load failure under the selected machine without throwing", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const failure = new Error("index unavailable");
    const controller = new UnmappedSessionController(
      () => state,
      setState,
      { api: { unmappedSessions: vi.fn().mockRejectedValue(failure) } },
    );

    await controller.load();

    expect(state.unmappedGroups).toEqual([]);
    expect(state.browserErrors[browserErrorScopeKey(machineBrowserErrorScope("local"))]?.message).toBe(String(failure));
  });

  it("treats a 404 as an unavailable index rather than an error", async () => {
    let state: AppState = { ...initialAppState(), unmappedGroups: groups };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const controller = new UnmappedSessionController(
      () => state,
      setState,
      { api: { unmappedSessions: vi.fn().mockRejectedValue(new HttpRequestError("not found", 404)) } },
    );

    await controller.load();

    expect(state.unmappedGroups).toEqual([]);
    expect(state.browserErrors[browserErrorScopeKey(machineBrowserErrorScope("local"))]).toBeUndefined();
  });

  it("discards a response that arrives after the machine changed", async () => {
    let state: AppState = { ...initialAppState() };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    let resolveResponse: (value: { generatedAt: string; groups: UnmappedSessionGroup[] }) => void = () => undefined;
    const pending = new Promise<{ generatedAt: string; groups: UnmappedSessionGroup[] }>((resolve) => { resolveResponse = resolve; });
    const controller = new UnmappedSessionController(
      () => state,
      setState,
      { api: { unmappedSessions: vi.fn().mockReturnValue(pending) } },
    );

    const loading = controller.load();
    state = { ...state, selectedMachine: { id: "remote", name: "remote", kind: "remote", createdAt: "now", updatedAt: "now" } };
    resolveResponse({ generatedAt: "now", groups });
    await loading;

    expect(state.unmappedGroups).toEqual([]);
  });
});
