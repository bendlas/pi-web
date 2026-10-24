// @vitest-environment happy-dom
import { html, render, svg } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import type { JsonValue, PluginPeerChannelOptions, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { LocalizationService } from "../../../src/client/src/localization/service.js";
import { createPluginLocalization } from "../../../src/client/src/plugins/localization.js";
import plugin from "../src/browser/index.js";
import { captainError, CaptainBrowserError, createCaptainContent } from "../src/browser/localization.js";
import type { LogEntry } from "../src/browser/protocol.js";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

const entry: LogEntry = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", createdAt: "2026-01-02T15:04:00Z",
  sourceSessionId: "source", sessionId: "pirate", question: "<img src=x> user question",
  status: "completed", stages: ["Connected. Live updates arrive from the backend."],
  text: "A **pirate** reply\n\n`<script>arrr</script>`\n\n- [x] Done",
};

async function setup(records: LogEntry[] = [], requestError?: Error, snapshot?: JsonValue) {
  const service = new LocalizationService({ development: true });
  await service.setPreferences({ language: "en", formatLocale: "en", timeZone: "UTC", hourCycle: "h23" });
  const lifetime = new AbortController();
  const localization = createPluginLocalization(service, "captains-log", "captains-log", lifetime.signal);
  const activation = await plugin.activate({
    apiVersion: 4, pluginId: "captains-log", runtimePluginId: "captains-log", html, svg, localization,
    signal: new AbortController().signal, lifetimeSignal: lifetime.signal,
  });
  const panel = activation.contributions.workspacePanels?.[0];
  if (!panel) throw new Error("Missing panel");
  const host = document.createElement("div");
  document.body.append(host);
  let receive: PluginPeerChannelOptions["onData"] = () => undefined;
  const send = vi.fn();
  const close = vi.fn();
  const openChannel = vi.fn((_operation: string, _input: JsonValue, options: PluginPeerChannelOptions) => {
    receive = options.onData;
    return Promise.resolve({ send, close, closed: new Promise<never>(() => undefined) });
  });
  const request = vi.fn((operation: string) => {
    if (requestError) return Promise.reject(requestError);
    return Promise.resolve(operation === "list" ? snapshot ?? records : records[0] ?? null);
  });
  const unavailable = () => Promise.reject(new Error("unused"));
  const noop = () => undefined;
  const requestRender = vi.fn(() => { render(panel.render(context), host); });
  const context: WorkspacePanelContext = {
    machine: { id: "local", name: "<b>Machine</b>", kind: "local" },
    workspace: { id: "main", projectId: "project", path: "/repo", label: "main", isMain: true },
    state: { mainView: "workspace", selectedSession: { id: "source", name: "<b>my session</b>", cwd: "/repo", archived: false, pending: false } },
    host: { requestRender }, navigate: vi.fn(() => Promise.resolve()),
    peer: { openChannel, request },
    files: { readFile: unavailable, listFiles: unavailable, writeFile: unavailable, deleteFile: unavailable, moveFile: unavailable },
    prompt: { insertText: noop, getText: () => "", getSelection: () => null },
    terminal: { open: noop, runCommand: unavailable },
  };
  render(panel.render(context), host);
  await vi.waitFor(() => { expect(host.querySelector(".captain-diagnostics")?.textContent).not.toContain("Connecting to Captain"); });
  return { service, lifetime, activation, panel, host, request, openChannel, send, close, requestRender, context, receive: (frame: JsonValue) => { receive(frame); } };
}

it("switches live labels, saved content, dates and counts without reconnecting, reading, or translating", async () => {
  const previous = { ...entry, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", createdAt: "2026-01-01T15:04:00Z" };
  const test = await setup([entry, previous]);
  const { host, service } = test;
  expect(test.request.mock.calls.map(([op]) => op)).toEqual(["list", "read"]);
  const details = requiredElement(host, ".captain-diagnostics", HTMLDetailsElement);
  details.open = true;
  const primary = requiredElement(host, ".captain-primary", HTMLButtonElement);
  primary.focus();
  const initialDate = host.querySelector("time")?.textContent;
  const question = host.querySelector(".captain-diagnostics > p[dir]")?.textContent;
  for (const language of ["en-XA", "ar-XB"]) {
    await service.setPreferences({ language, formatLocale: "ar-EG", timeZone: "Asia/Tokyo" });
    expect(test.panel.title).not.toBe("Captain's Log");
    expect(test.activation.contributions.actions?.[0]?.title).not.toBe("Open pirate translator");
    expect(primary.textContent).not.toBe("Let the Captain tell it");
    expect(host.querySelector(".captain-source strong")?.textContent).toBe("<b>my session</b>");
    expect(host.querySelector(".captain-answer strong")?.textContent).toBe("pirate");
    expect(host.querySelector("code")?.textContent).toBe("<script>arrr</script>");
    expect(host.querySelector("code")?.getAttribute("dir")).toBe("ltr");
    expect(host.querySelector("input")?.getAttribute("aria-label")).not.toBe("Task completed");
    expect(host.querySelector("script,img,b")).toBeNull();
    expect(host.querySelector(".captain-diagnostics > p[dir]")?.textContent).toBe(question);
    expect(host.querySelector(".captain-diagnostics li")?.textContent).toBe(entry.stages[0]);
    expect(host.querySelector("time")?.textContent).toBe(service.date(new Date(entry.createdAt), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
    expect(host.querySelector(".captain-secondary summary")?.textContent).toContain(service.number(2));
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(primary);
  }
  expect(host.querySelector("time")?.textContent).not.toBe(initialDate);
  expect(host.querySelector(".captains-log")?.getAttribute("dir")).toBe("rtl");
  expect(test.request).toHaveBeenCalledTimes(2);
  expect(test.openChannel).toHaveBeenCalledTimes(1);
  expect(test.send).not.toHaveBeenCalled();
  expect(test.close).not.toHaveBeenCalled();
  test.lifetime.abort();
  await test.activation.dispose?.(new AbortController().signal);
  const renders = test.requestRender.mock.calls.length;
  await service.setPreferences({ language: "en", formatLocale: "en" });
  expect(test.requestRender).toHaveBeenCalledTimes(renders);
});

it("keeps pending admission and backend notices intact across language switches", async () => {
  const test = await setup();
  requiredElement(test.host, ".captain-primary", HTMLButtonElement).click();
  expect(test.send).toHaveBeenCalledTimes(1);
  const frame: unknown = test.send.mock.calls[0]?.[0];
  if (typeof frame !== "object" || frame === null || !("requestId" in frame) || typeof frame.requestId !== "string") throw new Error("Expected translation request");
  await test.service.setPreferences({ language: "ar-XB", formatLocale: "en" });
  expect(test.host.querySelector<HTMLButtonElement>(".captain-primary")?.disabled).toBe(true);
  expect(test.host.querySelector(".captain-diagnostics > p")?.textContent).toContain("source");
  test.receive({ type: "rejected", requestId: frame.requestId, message: "Connected. Live updates arrive from the backend." });
  await test.service.setPreferences({ language: "en-XA", formatLocale: "en" });
  expect(test.host.querySelector('[role="alert"]')?.textContent).toBe("Connected. Live updates arrive from the backend.");
  expect(test.send).toHaveBeenCalledTimes(1);
  expect(test.request).toHaveBeenCalledTimes(1);
  expect(test.openChannel).toHaveBeenCalledTimes(1);
  test.lifetime.abort();
  await test.activation.dispose?.(new AbortController().signal);
});

it("retains local error origin instead of matching English backend errors", async () => {
  const service = new LocalizationService({ development: true });
  const lifetime = new AbortController();
  const content = createCaptainContent(createPluginLocalization(service, "captains-log", "captains-log", lifetime.signal));
  const backend = new Error("Invalid Captain snapshot");
  await service.setPreferences({ language: "en-XA", formatLocale: "en" });
  expect(captainError(content, new CaptainBrowserError("invalidSnapshot"))).not.toContain("Invalid Captain snapshot");
  expect(captainError(content, backend)).toBe("Error: Invalid Captain snapshot");
  lifetime.abort();

  const test = await setup([], backend);
  const initial = test.host.querySelector(".captain-diagnostics > p")?.textContent;
  await test.service.setPreferences({ language: "en-XA", formatLocale: "en" });
  const changed = test.host.querySelector(".captain-diagnostics > p")?.textContent;
  expect(changed).toContain("Error: Invalid Captain snapshot");
  expect(changed).not.toBe(initial);
  expect(test.request).toHaveBeenCalledTimes(1);
  expect(test.openChannel).toHaveBeenCalledTimes(1);
  test.lifetime.abort();
  await test.activation.dispose?.(new AbortController().signal);
});

function requiredElement<ElementType extends Element>(host: HTMLElement, selector: string, type: new() => ElementType): ElementType {
  const element = host.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Missing ${selector}`);
  return element;
}

it("localizes retained browser snapshot failures and saved status enums but leaves backend stage prose unchanged", async () => {
  const test = await setup([], undefined, {});
  const before = test.host.querySelector(".captain-diagnostics > p")?.textContent;
  expect(before).toContain("Invalid Captain snapshot");
  await test.service.setPreferences({ language: "en-XA", formatLocale: "en" });
  const after = test.host.querySelector(".captain-diagnostics > p")?.textContent;
  expect(after).not.toContain("Invalid Captain snapshot");
  expect(after).not.toBe(before);
  expect(test.request).toHaveBeenCalledTimes(1);
  expect(test.openChannel).toHaveBeenCalledTimes(1);
  test.lifetime.abort();
  await test.activation.dispose?.(new AbortController().signal);

  const live = await setup();
  live.receive({ type: "entry", entry, saved: true });
  const saved = live.host.querySelector(".captain-diagnostics > p")?.textContent;
  expect(saved).toBe("Backend saved completed roundtrip.");
  await live.service.setPreferences({ language: "en-XA", formatLocale: "en" });
  expect(live.host.querySelector(".captain-diagnostics > p")?.textContent).not.toBe(saved);
  const backendStage = "Invalid Captain snapshot";
  live.receive({ type: "entry", entry: { ...entry, status: "running", stages: [backendStage] }, saved: false });
  await live.service.setPreferences({ language: "ar-XB", formatLocale: "en" });
  expect(live.host.querySelector(".captain-diagnostics > p")?.textContent).toContain(backendStage);
  expect(live.host.querySelector(".captain-diagnostics li")?.textContent).toBe(backendStage);
  expect(live.host.querySelector<HTMLButtonElement>(".captain-primary")?.disabled).toBe(true);
  expect(live.request).toHaveBeenCalledTimes(1);
  expect(live.openChannel).toHaveBeenCalledTimes(1);
  expect(live.send).not.toHaveBeenCalled();
  live.lifetime.abort();
  await live.activation.dispose?.(new AbortController().signal);
});
