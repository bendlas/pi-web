import { describe, expect, it } from "vitest";
import { parseUnmappedSessionsResponse } from "./parsers";

describe("parseUnmappedSessionsResponse", () => {
  it("parses groups and marks sessions read-only when the wire says so", () => {
    const response = parseUnmappedSessionsResponse({
      generatedAt: "2026-05-01T00:00:00.000Z",
      groups: [{
        cwd: "/gone",
        kind: "project",
        exists: false,
        sessions: [{
          id: "s1",
          path: "/sessions/s1.jsonl",
          cwd: "/gone",
          created: "2026-01-01T00:00:00.000Z",
          modified: "2026-01-02T00:00:00.000Z",
          messageCount: 2,
          firstMessage: "hello",
          readOnly: true,
        }],
      }],
    });

    expect(response.groups[0]?.kind).toBe("project");
    expect(response.groups[0]?.sessions[0]?.readOnly).toBe(true);
  });

  it("rejects an unknown group kind", () => {
    expect(() => parseUnmappedSessionsResponse({
      generatedAt: "now",
      groups: [{ cwd: "/x", kind: "worktree", exists: true, sessions: [] }],
    })).toThrow("Invalid unmapped session group kind");
  });
});
