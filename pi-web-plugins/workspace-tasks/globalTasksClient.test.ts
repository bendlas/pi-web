import { afterEach, describe, expect, it, vi } from "vitest";
import { loadGlobalTasksConfig } from "./globalTasksClient.js";

function jsonResponse(body: unknown, init: { ok: boolean; status: number }): Response {
  return new Response(JSON.stringify(body), { status: init.status });
}

describe("global tasks client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the global-tasks config route and maps a loaded result", async () => {
    const fetchMock = vi.fn<(input: string, init?: unknown) => Promise<Response>>(() => Promise.resolve(jsonResponse({
      kind: "loaded",
      config: { version: 1, tasks: [{ id: "git.log-oneline", title: "Git log", command: "git log --format=oneline", confirm: false }] },
      path: "/x/scripts.json",
    }, { ok: true, status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadGlobalTasksConfig();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0] ?? "").toContain("/api/global-tasks/config");
    expect(result).toMatchObject({
      kind: "loaded",
      config: { tasks: [{ id: "git.log-oneline" }] },
    });
  });

  it("maps a missing result from the server", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(
      { kind: "missing", message: "No global scripts configured.", hint: "Create ~/.pi-web/scripts.json to define scripts available in every workspace (legacy ~/.pi-web/tasks.json is still read)." },
      { ok: true, status: 200 },
    ))));
    await expect(loadGlobalTasksConfig()).resolves.toMatchObject({ kind: "missing" });
  });

  it("maps an unavailable result from the server", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(
      { kind: "unavailable", message: "Could not load global scripts.", hint: "Fix ~/.pi-web/scripts.json, then click Refresh.", detail: "Config version must be 1" },
      { ok: true, status: 200 },
    ))));
    await expect(loadGlobalTasksConfig()).resolves.toMatchObject({ kind: "unavailable", detail: "Config version must be 1" });
  });

  it("degrades non-ok responses to unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({}, { ok: false, status: 500 }))));
    await expect(loadGlobalTasksConfig()).resolves.toMatchObject({ kind: "unavailable", detail: "HTTP 500" });
  });

  it("degrades network failures to unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    await expect(loadGlobalTasksConfig()).resolves.toMatchObject({ kind: "unavailable", detail: "offline" });
  });

  it("rejects malformed payloads as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ version: 1 }, { ok: true, status: 200 }))));
    await expect(loadGlobalTasksConfig()).resolves.toMatchObject({ kind: "unavailable" });
  });
});
