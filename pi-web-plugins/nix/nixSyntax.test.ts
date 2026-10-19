import { describe, expect, it } from "vitest";
import { highlightNix, nixSyntaxHighlighter } from "./nixSyntax";

function highlight(text: string) {
  return highlightNix({ text, signal: new AbortController().signal });
}

function colored(text: string) {
  return highlight(text).map(({ from, to, kind }) => [text.slice(from, to), kind] as const);
}

describe("Nix grammar highlighting", () => {
  it("colors attribute names, keywords, comments, strings, numbers, and paths", () => {
    const text = '{ pkgs, ... }:\nlet\n  # a comment\n  name = "hello";\n  count = 42;\n  flag = true;\n  path = ./default.nix;\nin pkgs';
    expect(colored(text)).toEqual([
      ["{", "punctuation"], ["pkgs", "property"], ["}", "punctuation"],
      ["let", "keyword"], ["# a comment", "comment"],
      ["name", "property"], ['"hello"', "string"],
      ["count", "property"], ["42", "number"],
      ["flag", "property"], ["true", "literal"],
      ["path", "property"], ["./default.nix", "literal"],
      ["in", "keyword"], ["pkgs", "property"],
    ]);
  });

  it("keeps set members, function arguments, and control keywords distinct", () => {
    const text = "rec { inherit (pkgs) lib; x = if true then null else 1.5; }";
    expect(colored(text)).toEqual([
      ["rec", "keyword"], ["{", "punctuation"], ["inherit", "keyword"],
      ["(", "punctuation"], ["pkgs", "property"], [")", "punctuation"],
      ["lib", "property"], ["x", "property"], ["if", "keyword"], ["true", "literal"],
      ["then", "keyword"], ["null", "keyword"], ["else", "keyword"], ["1.5", "number"], ["}", "punctuation"],
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
      ["builtins", "keyword"], ["map", "property"], ["(", "punctuation"],
      ["x", "property"], ["x", "property"], ["1", "number"], [")", "punctuation"],
      ["[", "punctuation"], ["1", "number"], ["2", "number"], ["3", "number"], ["]", "punctuation"],
    ]);
    let end = 0;
    for (const token of tokens) {
      expect(token.from).toBeGreaterThanOrEqual(end);
      expect(token.to).toBeGreaterThan(token.from);
      end = token.to;
      expect(Object.keys(token).sort()).toEqual(["from", "kind", "to"]);
    }
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
