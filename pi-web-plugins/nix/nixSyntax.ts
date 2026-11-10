import type { SyntaxHighlighterContribution, SyntaxHighlightToken, SyntaxHighlightTokenKind } from "@jmfederico/pi-web/plugin-api";
import hljs from "highlight.js/lib/core";
import nix from "highlight.js/lib/languages/nix";

/**
 * Highlight.js classes the Nix grammar emits, mapped to host-neutral token kinds.
 * Interpolation wrappers (`hljs-subst`) stay unmapped so their delimiters keep the
 * surrounding string kind and their nested expressions highlight independently.
 */
const kindByClass: ReadonlyMap<string, SyntaxHighlightTokenKind> = new Map<string, SyntaxHighlightTokenKind>([
  ["hljs-keyword", "keyword"],
  ["hljs-literal", "literal"],
  ["hljs-built_in", "function"],
  ["hljs-number", "number"],
  ["hljs-string", "string"],
  ["hljs-char", "string"],
  ["hljs-comment", "comment"],
  ["hljs-symbol", "literal"],
  ["hljs-attr", "property"],
  ["hljs-params", "variable"],
  ["hljs-operator", "operator"],
  ["hljs-meta", "meta"],
]);

if (hljs.getLanguage("nix") === undefined) hljs.registerLanguage("nix", nix);

const spanPattern = /<span(?: class="([^"]*)")?>|<\/span>/gu;
const entityPattern = /&(?:[a-zA-Z]+|#[0-9]+|#x[0-9a-fA-F]+);/gu;

function kindForStack(stack: readonly (readonly string[] | undefined)[]): SyntaxHighlightTokenKind | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    for (const name of stack[index] ?? []) {
      const kind = kindByClass.get(name);
      if (kind !== undefined) return kind;
    }
  }
  return undefined;
}

/**
 * Highlight.js escapes source text as single-character HTML entities, so every
 * entity shortens the visible source by exactly one UTF-16 code unit.
 */
function visibleLength(chunk: string): number {
  return chunk.replace(entityPattern, "x").length;
}

/** Converts the Nix grammar's styled HTML into sorted, non-overlapping source ranges. */
export function highlightNix({ text, signal }: { text: string; signal: AbortSignal }): readonly SyntaxHighlightToken[] {
  signal.throwIfAborted();
  const html = hljs.highlight(text, { language: "nix", ignoreIllegals: true }).value;
  const tokens: SyntaxHighlightToken[] = [];
  const stack: (readonly string[] | undefined)[] = [];
  let position = 0;
  let cursor = 0;

  const emit = (chunk: string): void => {
    const length = visibleLength(chunk);
    if (length === 0) return;
    const kind = kindForStack(stack);
    if (kind !== undefined && position + length <= text.length) {
      const previous = tokens.at(-1);
      if (previous?.to === position && previous.kind === kind) {
        tokens[tokens.length - 1] = { from: previous.from, to: position + length, kind };
      } else {
        tokens.push({ from: position, to: position + length, kind });
      }
    }
    position += length;
  };

  for (let match = spanPattern.exec(html); match !== null; match = spanPattern.exec(html)) {
    emit(html.slice(cursor, match.index));
    cursor = spanPattern.lastIndex;
    if (match[0] === "</span>") stack.pop();
    else stack.push(match[1] === undefined ? undefined : match[1].split(/\s+/u));
  }
  emit(html.slice(cursor));
  signal.throwIfAborted();
  return tokens;
}

export const nixSyntaxHighlighter: SyntaxHighlighterContribution = {
  id: "syntax",
  languages: ["nix"],
  fileExtensions: ["nix"],
  highlight: highlightNix,
};
