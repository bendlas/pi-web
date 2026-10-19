import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { highlightNix, nixSyntaxHighlighter } from "./nixSyntax";

function highlight(text: string) {
  return highlightNix({ text, signal: new AbortController().signal });
}

function colored(text: string) {
  return highlight(text).map(({ from, to, kind }) => [text.slice(from, to), kind] as const);
}

describe("Nix grammar highlighting", () => {
  it("colors attribute names, keywords, comments, strings, numbers, operators, and paths", () => {
    const text = '{ pkgs, ... }:\nlet\n  # a comment\n  name = "hello";\n  count = 42;\n  flag = true;\n  path = ./default.nix;\nin pkgs';
    expect(colored(text)).toEqual([
      ["let", "keyword"], ["# a comment", "comment"],
      ["name", "property"], ["=", "operator"], ['"hello"', "string"],
      ["count", "property"], ["=", "operator"], ["42", "number"],
      ["flag", "property"], ["=", "operator"], ["true", "literal"],
      ["path", "property"], ["=", "operator"], ["./default.nix", "literal"],
      ["in", "keyword"],
    ]);
  });

  it("keeps set members, function arguments, and control keywords distinct", () => {
    const text = "rec { inherit (pkgs) lib; x = if true then null else 1.5; }";
    expect(colored(text)).toEqual([
      ["rec", "keyword"], ["inherit", "keyword"], ["x", "property"], ["=", "operator"],
      ["if", "keyword"], ["true", "literal"], ["then", "keyword"], ["null", "literal"],
      ["else", "keyword"], ["1.5", "number"],
    ]);
  });

  it("protects block comments and both string forms, including escaped interpolation", () => {
    const text = '/* block\n comment */ "a\\n\\${x}b" \'\'indented text\'\'';
    expect(colored(text)).toEqual([
      ["/* block\n comment */", "comment"],
      ['"a\\n\\${x}b"', "string"],
      ["''indented text''", "string"],
    ]);
  });

  it("returns sorted, non-overlapping ranges with only token fields", () => {
    const text = "builtins.map (x: x + 1) [ 1 2 3 ]";
    const tokens = highlight(text);
    expect(colored(text)).toEqual([
      ["builtins.map", "function"], ["x:", "variable"], ["+", "operator"],
      ["1", "number"], ["1", "number"], ["2", "number"], ["3", "number"],
    ]);
    let end = 0;
    for (const token of tokens) {
      expect(token.from).toBeGreaterThanOrEqual(end);
      expect(token.to).toBeGreaterThan(token.from);
      expect(token.to).toBeLessThanOrEqual(text.length);
      end = token.to;
      expect(Object.keys(token).sort()).toEqual(["from", "kind", "to"]);
    }
  });

  it("keeps highlighting after indented strings with escaped interpolation", () => {
    const text = readFileSync(fileURLToPath(new URL("../../test-fixtures/nix-syntax-sample.nix", import.meta.url)), "utf8");
    const tokens = highlight(text);
    let end = 0;
    for (const token of tokens) {
      expect(token.from).toBeGreaterThanOrEqual(end);
      expect(token.to).toBeGreaterThan(token.from);
      expect(token.to).toBeLessThanOrEqual(text.length);
      end = token.to;
    }
    // The build phase's indented string must close before the following attribute,
    // rather than swallowing the rest of the file as one string token.
    const buildPhase = tokens.find((token) => token.kind === "string" && text.slice(token.from, token.to).includes("kept literal"));
    expect(buildPhase).toBeDefined();
    expect(buildPhase?.to).toBeLessThan(text.indexOf("installPhase"));
    expect(tokens.some((token) => token.kind === "operator" && text.slice(token.from, token.to) === "+")).toBe(true);
    expect(tokens.some((token) => token.kind === "number" && text.slice(token.from, token.to) === "1.5")).toBe(true);
  });

  it("stops before parsing when the request is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => highlightNix({ text: "let x = 1; in x", signal: controller.signal })).toThrow();
  });

  it("offers a Nix contribution for chat fences and files without renderer side effects", () => {
    expect(nixSyntaxHighlighter).toEqual({
      id: "syntax", languages: ["nix"], fileExtensions: ["nix"], highlight: highlightNix,
    });
  });
});
