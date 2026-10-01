import { describe, expect, it } from "vitest";
import {
  AGENT_TASKS_DIR,
  loadAgentTasks,
  parseAgentTasks,
  statusIcon,
  taskCountLabel,
  type AgentTaskFileReader,
} from "./agentTasksClient";

const missing = () => Promise.reject(new Error("not found"));

function reader(files: Readonly<Record<string, string>>, directories: Readonly<Record<string, readonly { name: string; path: string; type: string }[]>> = {}): AgentTaskFileReader {
  return {
    readFile: (path) => {
      const content = files[path];
      return content === undefined ? missing() : Promise.resolve({ content, binary: false, truncated: false });
    },
    listFiles: (path) => {
      const entries = directories[path];
      return entries === undefined ? missing() : Promise.resolve({ entries });
    },
  };
}

const sessionFile = (id: string, subject: string, status = "pending") =>
  JSON.stringify({ nextId: 2, tasks: [{ id, subject, status }] });

describe("agent tasks client", () => {
  it("parses the object envelope and a bare array, dropping entries without an id", () => {
    expect(parseAgentTasks(JSON.stringify({ nextId: 3, tasks: [{ id: "1", subject: "One" }, { subject: "no id" }] }))).toEqual([
      { id: "1", subject: "One", status: "pending", blockedBy: [] },
    ]);
    expect(parseAgentTasks(JSON.stringify([{ id: "2", subject: "Two", status: "completed", blockedBy: ["1"] }]))).toEqual([
      { id: "2", subject: "Two", status: "completed", blockedBy: ["1"] },
    ]);
    expect(parseAgentTasks("{ not json")).toEqual([]);
  });

  it("keeps the selected session's copy on dedup and sorts numerically", async () => {
    const files = reader({
      [`${AGENT_TASKS_DIR}/tasks-session-1.json`]: JSON.stringify({
        tasks: [
          { id: "10", subject: "ten" },
          { id: "2", subject: "two from session" },
        ],
      }),
      [`${AGENT_TASKS_DIR}/tasks.json`]: JSON.stringify({
        tasks: [
          { id: "2", subject: "two from project" },
          { id: "1", subject: "one" },
        ],
      }),
    });

    await expect(loadAgentTasks(files, "session-1")).resolves.toEqual([
      { id: "1", subject: "one", status: "pending", blockedBy: [] },
      { id: "2", subject: "two from session", status: "pending", blockedBy: [] },
      { id: "10", subject: "ten", status: "pending", blockedBy: [] },
    ]);
  });

  it("aggregates every session file when no session is selected", async () => {
    const files = reader(
      {
        [`${AGENT_TASKS_DIR}/tasks-a.json`]: sessionFile("1", "from a"),
        [`${AGENT_TASKS_DIR}/tasks-b.json`]: sessionFile("2", "from b"),
      },
      {
        [AGENT_TASKS_DIR]: [
          { name: "tasks-a.json", path: `${AGENT_TASKS_DIR}/tasks-a.json`, type: "file" },
          { name: "tasks-b.json", path: `${AGENT_TASKS_DIR}/tasks-b.json`, type: "file" },
          { name: "notes.txt", path: `${AGENT_TASKS_DIR}/notes.txt`, type: "file" },
          { name: "sub", path: `${AGENT_TASKS_DIR}/sub`, type: "directory" },
        ],
      },
    );

    await expect(loadAgentTasks(files, undefined)).resolves.toEqual([
      { id: "1", subject: "from a", status: "pending", blockedBy: [] },
      { id: "2", subject: "from b", status: "pending", blockedBy: [] },
    ]);
  });

  it("degrades missing files and unreadable directories to an empty list", async () => {
    await expect(loadAgentTasks(reader({}), "session-1")).resolves.toEqual([]);
    await expect(loadAgentTasks(reader({}), undefined)).resolves.toEqual([]);
  });

  it("summarizes counts and statuses", () => {
    const tasks = [
      { id: "1", subject: "a", status: "completed", blockedBy: [] },
      { id: "2", subject: "b", status: "in_progress", blockedBy: [] },
      { id: "3", subject: "c", status: "pending", blockedBy: [] },
    ];
    expect(taskCountLabel(tasks)).toBe("1 done · 1 active · 1 open");
    expect(taskCountLabel([])).toBe("no tasks");
    expect(statusIcon("completed")).toBe("\u2714");
    expect(statusIcon("in_progress")).toBe("\u25A0");
    expect(statusIcon("pending")).toBe("\u25A1");
  });
});
