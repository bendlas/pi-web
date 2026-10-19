import { describe, expect, it } from "vitest";
import plugin from "./pi-web-plugin.js";
import { nixSyntaxHighlighter } from "./nixSyntax.js";

describe("Nix plugin", () => {
  it("contributes a Nix grammar behind the syntax-highlighting capability", () => {
    expect(plugin.apiVersion).toBe(5);
    expect(plugin.requires).toContainEqual(expect.objectContaining({ pluginId: "pi-web", id: "syntax-highlighting", version: 1 }));
    expect(plugin.activate().contributions.syntaxHighlighters).toEqual([nixSyntaxHighlighter]);
  });
});
