import type { PiWebPlugin, PluginCapability, SyntaxHighlightingCapability } from "@jmfederico/pi-web/plugin-api";
import { nixSyntaxHighlighter } from "./nixSyntax";

// Fail explicitly on older hosts that cannot consume syntax highlighters.
const syntaxHighlightingCapability: PluginCapability<SyntaxHighlightingCapability> = {
  pluginId: "pi-web", id: "syntax-highlighting", version: 1,
  parse(value) {
    if (!isSyntaxHighlighting(value)) throw new Error("The Nix plugin requires syntax highlighting capability v1");
    return value;
  },
};

function isSyntaxHighlighting(value: unknown): value is SyntaxHighlightingCapability {
  return typeof value === "object" && value !== null
    && "supports" in value && typeof value.supports === "function"
    && "highlight" in value && typeof value.highlight === "function";
}

const plugin = {
  apiVersion: 5,
  name: "Nix",
  requires: [syntaxHighlightingCapability],
  activate: () => ({
    contributions: {
      syntaxHighlighters: [nixSyntaxHighlighter],
    },
  }),
} satisfies PiWebPlugin;

export default plugin;
