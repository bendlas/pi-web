// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { ConversationLayout, conversationLayoutMessages as messages } from "./ConversationLayout";
import { localization } from "../localization/browser";

afterEach(async () => {
  document.body.replaceChildren();
  localStorage.clear();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

it("updates the activity live region without replacing activity or status objects", async () => {
  const layout = new ConversationLayout();
  const activity = { sessionId: "test", phase: "active" as const, label: "Raw label العربية", detail: "<runtime detail>", at: "2026-10-21T00:00:00Z" };
  layout.activity = activity;
  document.body.append(layout);
  await layout.updateComplete;
  const region = layout.shadowRoot?.querySelector('[aria-live="polite"]');
  expect(region?.textContent).toContain("Raw label العربية: <runtime detail>");
  for (const language of ["en-XA", "ar-XB"]) {
    await localization.setPreferences({ language, formatLocale: "en" });
    await layout.updateComplete;
    expect(region?.textContent).toContain(messages.t("summary", { label: activity.label, detail: activity.detail }));
    expect(region?.textContent).toContain(activity.label);
    expect(region?.textContent).toContain(activity.detail);
  }
  layout.sending = true;
  await layout.updateComplete;
  expect(region?.textContent).toContain(messages.t("sending"));
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  await layout.updateComplete;
  expect(region?.textContent).toContain("Sending your message…");
  layout.sending = false;
  layout.activity = undefined;
  layout.status = { sessionId: "test", isStreaming: true, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
  await layout.updateComplete;
  expect(region?.textContent).toContain("running");
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  await layout.updateComplete;
  expect(region?.textContent).toContain(messages.t("running"));
  layout.status = { ...layout.status, isStreaming: false };
  await layout.updateComplete;
  expect(region?.textContent.trim()).toBe("");
});
