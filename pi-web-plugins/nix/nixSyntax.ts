import type { SyntaxHighlighterContribution, SyntaxHighlightToken, SyntaxHighlightTokenKind } from "@jmfederico/pi-web/plugin-api";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { nixLanguage } from "@replit/codemirror-lang-nix";

/** Reuses the bundled Nix grammar, but only through host-neutral semantic tokens. */
const kindByClass: ReadonlyMap<string, SyntaxHighlightTokenKind> = new Map<string, SyntaxHighlightTokenKind>([
  ["tok-comment", "comment"],
  ["tok-keyword", "keyword"],
  ["tok-string", "string"],
  ["tok-string2", "string"],
  ["tok-number", "number"],
  ["tok-typeName", "type"],
  ["tok-className", "type"],
  ["tok-function", "function"],
  ["tok-propertyName", "property"],
  ["tok-variableName", "variable"],
  ["tok-operator", "operator"],
  ["tok-punctuation", "punctuation"],
  ["tok-atom", "literal"],
  ["tok-bool", "literal"],
  ["tok-null", "literal"],
  ["tok-literal", "literal"],
  ["tok-url", "string"],
  ["tok-meta", "meta"],
]);

function kindForClasses(classes: string): SyntaxHighlightTokenKind | undefined {
  for (const name of classes.split(" ")) {
    const kind = kindByClass.get(name);
    if (kind !== undefined) return kind;
  }
  return undefined;
}

/** Converts the Nix grammar's styled tree into sorted, non-overlapping source ranges. */
export function highlightNix({ text, signal }: { text: string; signal: AbortSignal }): readonly SyntaxHighlightToken[] {
  signal.throwIfAborted();
  const tree = nixLanguage.parser.parse(text);
  const tokens: SyntaxHighlightToken[] = [];
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    const kind = kindForClasses(classes);
    if (kind !== undefined && to > from) tokens.push({ from, to, kind });
  });
  signal.throwIfAborted();
  return tokens;
}

export const nixSyntaxHighlighter: SyntaxHighlighterContribution = {
  id: "syntax",
  languages: ["nix"],
  fileExtensions: ["nix"],
  highlight: highlightNix,
};
