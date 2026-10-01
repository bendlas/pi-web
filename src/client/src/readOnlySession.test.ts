import { describe, expect, it } from "vitest";
import { isReadOnlySession } from "./readOnlySession";

describe("isReadOnlySession", () => {
  it("treats archived and unmapped-history sessions as read-only", () => {
    expect(isReadOnlySession({ archived: true })).toBe(true);
    expect(isReadOnlySession({ readOnly: true })).toBe(true);
    expect(isReadOnlySession({ archived: true, readOnly: true })).toBe(true);
  });

  it("leaves ordinary and unknown sessions writable", () => {
    expect(isReadOnlySession({})).toBe(false);
    expect(isReadOnlySession(undefined)).toBe(false);
  });
});
