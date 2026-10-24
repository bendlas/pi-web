import { chatTranscriptMessages as messages } from "./chatTranscriptMessages";
import { summarizeArgs, type ArgumentSummaryPresentation, type ChatTextPresentation } from "./chatPresentation";

export function localizedArgumentSummary(presentation: ArgumentSummaryPresentation): string {
  return summarizeArgs(presentation.args, {
    replacement: () => messages.t("argsReplacement"),
    edits: (count) => messages.t("argsEdits", { count }),
    items: (count) => messages.t("argsItems", { count }),
    object: () => messages.t("argsObject"),
  });
}

export function localizedChatText(presentation: ChatTextPresentation): string {
  switch (presentation.kind) {
    case "arguments": return localizedArgumentSummary(presentation);
    case "imagePlaceholder": return messages.t("imagePlaceholder");
    case "modelError": return messages.t("modelFailure", { detail: presentation.detail, detailed: presentation.detail === "" ? "no" : "yes" });
    case "bash": {
      const lines = presentation.excluded ? [messages.t("shellExcluded"), "", `$ ${presentation.command}`] : [`$ ${presentation.command}`];
      if (presentation.output !== undefined) lines.push("", presentation.output);
      if (presentation.exitCode !== undefined) lines.push("", messages.t("shellExit", { code: presentation.exitCode }));
      if (presentation.cancelled) lines.push("", messages.t("shellCancelled"));
      if (presentation.truncated) lines.push("", messages.t("shellTruncated"));
      if (presentation.fullOutputPath !== undefined) lines.push("", messages.t("shellFullOutput", { path: presentation.fullOutputPath }));
      return lines.join("\n");
    }
  }
}
