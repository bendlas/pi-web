// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserLocalizationPreferences, initializeLocalization, localization } from "../../localization/browser";
import { SettingsLocalizationPanel, localizationSettingsMessages as messages } from "./SettingsLocalizationPanel";
import { SettingsGeneralPanel } from "./SettingsGeneralPanel";

const releases: (() => void)[] = [];
beforeEach(async () => { await localization.setPreferences({ language: "en", formatLocale: "en-US" }); });
afterEach(async () => {
  document.body.replaceChildren();
  releases.splice(0).forEach((release) => { release(); });
  await localization.setPreferences({ language: "en", formatLocale: "en" });
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
  vi.restoreAllMocks();
});
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected localization control");
  return value;
}
async function mount(): Promise<SettingsLocalizationPanel> {
  const panel = new SettingsLocalizationPanel();
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}
function control(panel: SettingsLocalizationPanel, id: string): HTMLInputElement | HTMLSelectElement {
  return required(panel.renderRoot.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`));
}
function edit(panel: SettingsLocalizationPanel, id: string, value: string): void {
  const field = control(panel, id);
  field.value = value;
  field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}
async function submit(panel: SettingsLocalizationPanel): Promise<void> {
  required(panel.renderRoot.querySelector("form")).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await localization.ready;
  await panel.updateComplete;
  await panel.updateComplete;
}
function addGerman(load = () => Promise.resolve({ heading: "Sprache und Region", apply: "Hier anwenden" })): void {
  releases.push(localization.registerCatalog({ id: "settings-language-test", namespace: "core.settingsLocalization", locale: "de", load }));
}

it("is available inside General even while gateway and machine configuration are unavailable", async () => {
  const general = new SettingsGeneralPanel();
  general.loading = true;
  general.machineLoading = true;
  document.body.append(general);
  await general.updateComplete;
  const panel = required(general.renderRoot.querySelector<SettingsLocalizationPanel>("settings-localization-panel"));
  await panel.updateComplete;
  expect(control(panel, "formatLocale").disabled).toBe(false);
});

it("discovers language packs lazily and applies independent preferences, live metadata and persistence", async () => {
  const load = vi.fn(() => Promise.resolve({ heading: "Sprache und Region", apply: "Hier anwenden" }));
  addGerman(load);
  releases.push(await initializeLocalization(localization, window, true));
  await localization.setPreferences({ language: "en", formatLocale: "en-US" });
  const panel = await mount();
  expect(control(panel, "language").querySelector('option[value="de"]')?.textContent).toContain("German");
  expect(load).not.toHaveBeenCalled();
  edit(panel, "language", "de");
  edit(panel, "formatLocale", "ar-EG");
  edit(panel, "timeZone", "Asia/Tokyo");
  edit(panel, "hourCycle", "h23");
  expect(localization.preferences.language).toBe("en");
  await submit(panel);
  expect(localization.preferences).toEqual({ language: "de", formatLocale: "ar-EG", timeZone: "Asia/Tokyo", hourCycle: "h23" });
  expect(panel.renderRoot.querySelector("h3")?.textContent).toBe("Sprache und Region");
  expect(panel.renderRoot.querySelector(".ui-settings-summary")?.textContent).toContain(new Intl.NumberFormat("ar-EG").format(12345.67));
  expect(document.documentElement.lang).toBe("de");
  expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "{}")).toEqual(localization.preferences);
  expect(load).toHaveBeenCalledOnce();
  expect(panel.renderRoot.querySelector('[role="status"]')?.textContent).toBe(messages.t("saved"));
});

it.each([["formatLocale", "en_bad", "invalidRegion"], ["formatLocale", " ", "invalidRegion"], ["timeZone", "Mars/Olympus", "invalidZone"]] as const)("validates %s, focuses and describes the error without changing preferences", async (id, value, key) => {
  const panel = await mount();
  const before = localization.preferences;
  edit(panel, id, value);
  await submit(panel);
  const field = control(panel, id);
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(field.getAttribute("aria-describedby")).toContain("localization-validation");
  expect(panel.shadowRoot?.activeElement).toBe(field);
  expect(panel.renderRoot.querySelector('[role="alert"]')?.textContent).toBe(messages.t(key));
  expect(localization.preferences).toEqual(before);
  await localization.setPreferences({ language: "ar-XB", formatLocale: "en-US" });
  await panel.updateComplete;
  expect(field.value).toBe(value);
  expect(panel.renderRoot.querySelector('[role="alert"]')?.textContent).toBe(messages.t(key));
});

it("keeps drafts and focus across catalog/pseudo changes, and releases disconnected observers", async () => {
  const panel = await mount();
  edit(panel, "formatLocale", "de-DE");
  const field = control(panel, "formatLocale");
  field.focus();
  for (const language of ["en-XA", "ar-XB", "en"]) {
    await localization.setPreferences({ language, formatLocale: "en-GB" });
    await panel.updateComplete;
    expect(control(panel, "formatLocale")).toBe(field);
    expect(field.value).toBe("de-DE");
    expect(panel.shadowRoot?.activeElement).toBe(field);
    expect(panel.renderRoot.querySelector("h3")?.textContent).toBe(messages.t("heading"));
    expect(field.dir).toBe("ltr");
  }
  panel.remove();
  const update = vi.spyOn(panel, "requestUpdate");
  await localization.setPreferences({ language: "en-XA", formatLocale: "en-US" });
  expect(update).not.toHaveBeenCalled();
  document.body.append(panel);
  await panel.updateComplete;
  expect(field.value).toBe("de-DE");
  expect(panel.renderRoot.querySelector("h3")?.textContent).toBe(messages.t("heading"));
});

it("disables both actions during lazy catalog loading without applying again", async () => {
  let finish: ((catalog: { heading: string; apply: string }) => void) | undefined;
  const load = vi.fn(() => new Promise<{ heading: string; apply: string }>((resolve) => { finish = resolve; }));
  addGerman(load);
  const panel = await mount();
  edit(panel, "language", "de");
  required(panel.renderRoot.querySelector("form")).dispatchEvent(new Event("submit", { cancelable: true }));
  await panel.updateComplete;
  expect([...panel.renderRoot.querySelectorAll("button, input, select")].every((control) => control.hasAttribute("disabled"))).toBe(true);
  expect(panel.renderRoot.querySelector('button[type="submit"]')?.textContent).toBe(messages.t("applying"));
  required(finish)({ heading: "Sprache und Region", apply: "Hier anwenden" });
  await localization.ready;
  await panel.updateComplete;
  expect(control(panel, "language").disabled).toBe(false);
  expect(load).toHaveBeenCalledOnce();
});

it("copies current browser defaults and removes explicit time-zone/hour overrides", async () => {
  await localization.setPreferences({ language: "en", formatLocale: "ar-EG", timeZone: "UTC", hourCycle: "h24" });
  const panel = await mount();
  edit(panel, "timeZone", "unsubmitted-invalid-draft");
  required(panel.renderRoot.querySelector<HTMLButtonElement>('button[type="button"]')).click();
  await localization.ready;
  await panel.updateComplete;
  expect(localization.preferences).toEqual(browserLocalizationPreferences());
  expect(control(panel, "timeZone").value).toBe("");
  expect(control(panel, "hourCycle").value).toBe("");
  expect(panel.renderRoot.querySelector('[role="status"]')?.textContent).toBe(messages.t("saved"));
});
