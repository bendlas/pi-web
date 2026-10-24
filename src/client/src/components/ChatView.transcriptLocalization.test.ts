// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();
import { afterEach, expect, it } from "vitest";
import { localization } from "../localization/browser";
import { chatTranscriptMessages as messages } from "../chatTranscriptMessages";
import { ChatView, chatMessageMetadataLabel } from "./ChatView";
import { TranscriptImage } from "./TranscriptImage";
import type { MessageActionsMenu } from "./chat/MessageActionsMenu";
import type { ImageGalleryDialog } from "./ImageGalleryDialog";
import { imagePresentation, settleImage } from "./imagePresentation.testSupport";
import { summarizeChatGroup } from "../chatGroups";
import { localizedChatGroupSummary } from "./chat/transcriptLabels";
import type { ChatLine } from "../chatTypes";

let release: (() => void) | undefined;
afterEach(async () => {
  document.body.replaceChildren();
  release?.(); release = undefined;
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  localStorage.clear();
});
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected transcript control");
  return value;
}
async function language(view: ChatView, language: string): Promise<void> {
  await localization.setPreferences({ language, formatLocale: "ar-EG", timeZone: "Asia/Tokyo", hourCycle: "h23" });
  await view.updateComplete;
}

it("updates metadata, role headings and part disclosures without replacing controls or raw content", async () => {
  release = localization.registerCatalog({ id: "transcript-test", namespace: "core.chatTranscript", locale: "de", load: () => Promise.resolve({
    thinking: "Gedanken", information: "Nachrichteninformationen", actions: "Nachrichtenaktionen",
  }) });
  const timestamp = "2026-10-15T20:10:00Z";
  const view = new ChatView();
  view.behaviors = { ...view.behaviors, followTail: false, rememberPosition: false };
  view.messages = [{ role: "assistant", entryId: "reply", meta: { timestamp, model: { id: "Raw <model>" }, thinkingLevel: "high" }, parts: [
    { type: "thinking", text: "Raw thinking <tag> العربية" }, { type: "text", text: "Raw reply" },
  ] }, { role: "skill", entryId: "skill", parts: [
    { type: "skillInvocation", name: "Raw <skill>", location: "/raw/path", content: "Raw source" },
    { type: "skillRead", name: "Raw <skill>", path: "/raw/<path>" },
  ] }, { role: "tool", entryId: "result", parts: [{ type: "toolResult", toolName: "raw_tool", text: "Raw failure", isError: true }] }];
  document.body.append(view); await view.updateComplete;
  const root = required(view.shadowRoot);
  // The historical activity group is collapsed; opening it renders its cached body.
  const group = required(root.querySelector<HTMLDetailsElement>(".event-group"));
  for (const details of root.querySelectorAll<HTMLDetailsElement>(".event-group")) {
    details.open = true; details.dispatchEvent(new Event("toggle"));
  }
  await view.updateComplete;
  const thinking = required(root.querySelector<HTMLDetailsElement>(".thinking"));
  const skill = required(root.querySelector<HTMLDetailsElement>(".skill-invocation"));
  skill.open = true; skill.dispatchEvent(new Event("toggle")); await view.updateComplete;
  const info = required(root.querySelector<HTMLButtonElement>(".msg-meta"));
  info.click(); await view.updateComplete; info.focus();
  for (const locale of ["de", "en-XA", "ar-XB"]) {
    await language(view, locale);
    expect(root.querySelector(".msg-meta")).toBe(info);
    expect(root.activeElement).toBe(info);
    expect(info.getAttribute("aria-label")).toBe(messages.t("information"));
    expect(info.getAttribute("aria-expanded")).toBe("true");
    expect(group.open).toBe(true); expect(skill.open).toBe(true); expect(thinking.open).toBe(true);
    expect(thinking.querySelector("summary")?.textContent).toBe(messages.t("thinking"));
    expect(root.querySelector(".skill-read strong")?.textContent).toBe(messages.t("loadedSkill", { name: "Raw <skill>" }));
    expect(root.querySelector(".skill-read small")?.textContent).toBe(messages.t("readSkill", { path: "/raw/<path>" }));
    expect(root.querySelector(".tool-result summary")?.textContent).toContain(messages.t("toolResult", { name: "raw_tool", failed: "yes" }));
    expect(root.querySelector(".visually-hidden")?.textContent).toBe(messages.t("role", { role: "assistant" }));
    expect(root.querySelector(".msg-meta-details")?.textContent).toBe(chatMessageMetadataLabel(required(view.messages[0])));
    const menu = required(root.querySelector<MessageActionsMenu>("pi-message-actions-menu"));
    await menu.updateComplete;
    expect(menu.shadowRoot?.querySelector("button")?.getAttribute("aria-label")).toBe(messages.t("actions"));
    expect(thinking.querySelector("formatted-text")).toHaveProperty("text", "Raw thinking <tag> العربية");
    expect(root.querySelector("skill, model, .skill-read path")).toBeNull();
  }
  const expectedDate = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Tokyo", hourCycle: "h23" }).format(new Date(timestamp));
  expect(chatMessageMetadataLabel(required(view.messages[0]))).toBe(localization.list([expectedDate, "Raw <model>", "high"]));
  expect(chatMessageMetadataLabel({ role: "user", parts: [], meta: { timestamp: "invalid" } })).toBe(messages.t("noMetadata"));
  thinking.open = false; thinking.dispatchEvent(new Event("toggle")); await view.updateComplete;
  await language(view, "de");
  expect(thinking.open).toBe(false); expect(thinking.querySelector("formatted-text")).toBeNull();
});

it("uses ICU counts and regional lists for every group-summary kind and role", async () => {
  await localization.setPreferences({ language: "ar-XB", formatLocale: "ar-EG" });
  const roles = ["user", "assistant", "tool", "system", "bash", "skill"] as const;
  const lines: ChatLine[] = roles.map((role) => ({ role, parts: [] }));
  const result = summarizeChatGroup(lines, localizedChatGroupSummary);
  for (const role of roles) expect(result).toContain(messages.t("roleCount", { role, count: 1 }));
  for (const [source, kind] of [["compaction", "compaction"], ["branch_summary", "branch"]] as const) {
    const result = summarizeChatGroup([{ role: "system", parts: [], source }, { role: "system", parts: [], source }], localizedChatGroupSummary);
    expect(result).toBe(messages.t("groupSummary", { kind, count: 2, roles: "" }));
  }
});

it("keeps image descriptions live in an already-open gallery and source disclosures", async () => {
  const view = new ChatView();
  view.messages = ["one", "two"].map((entryId) => ({ role: "tool", entryId, parts: [{ type: "image", mimeType: "image/png", data: "QUJD" }] }));
  document.body.append(view); await view.updateComplete;
  const root = required(view.shadowRoot);
  const images = Array.from(root.querySelectorAll<TranscriptImage>("pi-web-transcript-image"));
  await Promise.all(images.map((image) => settleImage(image)));
  const presentation = imagePresentation(required(images[1]));
  required(presentation.shadowRoot?.querySelector<HTMLButtonElement>(".image-button")).click();
  const gallery = required(root.querySelector<ImageGalleryDialog>("pi-web-image-gallery-dialog"));
  await gallery.updateComplete;
  const sources = required(root.querySelector<HTMLDetailsElement>(".image-output-sources"));
  sources.open = true; sources.dispatchEvent(new Event("toggle")); await view.updateComplete;
  const source = required(sources.querySelector(".image-output-source"));
  const fullImage = required(gallery.shadowRoot?.querySelector<HTMLImageElement>(".image-zoom-full"));
  for (const locale of ["en-XA", "ar-XB", "en"]) {
    await language(view, locale); await gallery.updateComplete;
    await Promise.all(images.map((image) => image.updateComplete)); await presentation.updateComplete;
    expect(root.querySelector("pi-web-transcript-image")).toBe(images[0]);
    expect(gallery.shadowRoot?.querySelector(".image-zoom-full")).toBe(fullImage);
    const description = messages.t("toolImage", { name: "", named: "no", index: 2, total: 2 });
    expect(fullImage.alt).toBe(description);
    expect(presentation.shadowRoot?.querySelector(".image-button")?.getAttribute("aria-label")).toContain(description);
    expect(sources.open).toBe(true);
    expect(sources.querySelector(".image-output-source")).toBe(source);
    expect(sources.querySelector("summary")?.textContent).toBe(messages.t("sources", { count: 2 }));
    expect(source.getAttribute("aria-label")).toBe(messages.t("output", { index: 1 }));
    expect(source.querySelector(".label")?.textContent).toBe(messages.t("sourceHeader", { name: "", named: "no", index: 1 }));
  }
});
