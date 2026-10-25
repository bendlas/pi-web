// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import type { SessionActivity } from "../api";
import { ConversationLayout, conversationActivityText, conversationLayoutMessages as messages } from "./ConversationLayout";
import { localization } from "../localization/browser";

afterEach(async () => {
  document.body.replaceChildren();
  localStorage.clear();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

it("localizes every structured startup variant live without replacing the activity", async () => {
  const layout = new ConversationLayout();
  document.body.append(layout);
  for (const intent of ["create", "open"] as const) {
    for (const stage of ["runtime", "extensions"] as const) {
      for (const catalogRefreshing of [false, true]) {
        const activity: SessionActivity = {
          sessionId: "test", phase: "active", at: "2026-10-21T00:00:00Z", startup: true,
          label: "Do not match English labels", detail: "Raw fallback العربية <detail>",
          startupPresentation: { intent, stage, catalogRefreshing },
        };
        layout.activity = activity;
        for (const language of ["en", "en-XA", "ar-XB"]) {
          await localization.setPreferences({ language, formatLocale: "en" });
          await layout.updateComplete;
          const text = layout.shadowRoot?.querySelector('[aria-live="polite"]')?.textContent;
          const expected = messages.t("startup", { intent, stage, refreshing: catalogRefreshing ? "yes" : "no" });
          expect(text).toContain(expected);
          expect(text).not.toContain(activity.label);
          expect(text).not.toContain(activity.detail);
          expect(layout.activity).toBe(activity);
          if (language === "en") {
            expect(expected).toBe(`${intent === "create" ? "Creating" : "Opening"} session: ${stage === "runtime" ? "Starting the Pi session" : "Loading session extensions"}${catalogRefreshing ? " · provider model lists are refreshing" : ""}`);
          }
        }
      }
    }
  }
});

it("preserves raw startup fallback without metadata or for unknown future stages", async () => {
  const activity: SessionActivity = {
    sessionId: "legacy", phase: "active", at: "now", startup: true,
    label: "Creating session", detail: "Starting the Pi session",
  };
  await localization.setPreferences({ language: "en-XA", formatLocale: "en" });
  const expected = messages.t("summary", { label: activity.label, detail: activity.detail ?? "" });
  expect(conversationActivityText(undefined, activity, false)).toBe(expected);
  const futureActivity: SessionActivity = {
    ...activity,
    startupPresentation: {
      intent: "create", catalogRefreshing: false,
      // @ts-expect-error A newer server may add stages unknown to this browser.
      stage: "future-stage",
    },
  };
  expect(conversationActivityText(undefined, futureActivity, false)).toBe(expected);
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
