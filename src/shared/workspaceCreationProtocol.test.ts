import { describe, expect, it } from "vitest";
import { parseWorkspaceCreationRequest } from "./workspaceCreationProtocol.js";

describe("parseWorkspaceCreationRequest", () => {
  it("accepts a name only", () => {
    expect(parseWorkspaceCreationRequest({ name: "feature-x" })).toEqual({ name: "feature-x" });
  });

  it("keeps optional baseRef and branchName only when non-empty", () => {
    expect(parseWorkspaceCreationRequest({ name: "wt", baseRef: "main", branchName: "br" }))
      .toEqual({ name: "wt", baseRef: "main", branchName: "br" });
    expect(parseWorkspaceCreationRequest({ name: "wt", baseRef: "" }))
      .toEqual({ name: "wt" });
  });

  it("rejects a missing or empty name", () => {
    expect(() => parseWorkspaceCreationRequest({})).toThrow(/name/);
    expect(() => parseWorkspaceCreationRequest({ name: "" })).toThrow(/name/);
    expect(() => parseWorkspaceCreationRequest(null)).toThrow(/object/);
  });

  it("rejects non-string baseRef or branchName", () => {
    expect(() => parseWorkspaceCreationRequest({ name: "wt", baseRef: 5 })).toThrow(/baseRef/);
    expect(() => parseWorkspaceCreationRequest({ name: "wt", branchName: true })).toThrow(/branchName/);
  });
});
