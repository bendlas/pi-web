// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { html, LitElement, render } from "lit";
import { initializeLocalization, LocalizationController } from "./browser.js";
import { LocalizationService, message, type RichMessageTag } from "./service.js";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
  vi.restoreAllMocks();
});

describe("browser localization boundary", () => {
  it("restores separate preferences, updates document metadata and persists live changes", async () => {
    localStorage.setItem("pi-web-localization", JSON.stringify({ language: "ar", formatLocale: "de-DE", timeZone: "UTC" }));
    const service = new LocalizationService();
    const messages = service.registerMessages("test", { cancel: message("Cancel", "Cancel the operation") });
    service.registerCatalog({ id: "ar", namespace: "test", locale: "ar", load: () => Promise.resolve({ cancel: "إلغاء" }) });
    const dispose = await initializeLocalization(service, window, false);
    expect(messages.t("cancel")).toBe("إلغاء");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(service.preferences.formatLocale).toBe("de-DE");
    await service.setPreferences({ language: "en", formatLocale: "en-GB", hourCycle: "h12" });
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "{}")).toEqual(service.preferences);
    dispose();
    await service.setPreferences({ language: "ar", formatLocale: "en-GB" });
    expect(document.documentElement.lang).toBe("en");
  });

  it("reports corrupt storage, uses browser defaults and keeps query pseudo modes out of saved preferences", async () => {
    localStorage.setItem("pi-web-localization", "null");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = new LocalizationService({ development: true });
    const dispose = await initializeLocalization(service, { localStorage, document, navigator,
      location: { search: "?pseudoLocale=ar-XB" } }, true);
    expect(warn).toHaveBeenCalledOnce();
    expect(service.language).toBe("ar-XB");
    expect(document.documentElement.dir).toBe("rtl");
    expect(localStorage.getItem("pi-web-localization")).toBe("null");
    dispose();
  });

  it("inherits independent gateway defaults without persisting them until the user changes preferences", async () => {
    const service = new LocalizationService();
    const defaults = { language: "fr", timeZone: "UTC", hourCycle: "h23" as const };
    let dispose = await initializeLocalization(service, window, false, defaults);
    expect(service.preferences).toEqual({ ...defaults, formatLocale: navigator.languages[0] ?? navigator.language });
    expect(localStorage.getItem("pi-web-localization")).toBeNull();
    const release = service.registerCatalog({ id: "default-test", namespace: "test", locale: "fr", load: () => Promise.resolve({}) });
    await service.ready;
    expect(localStorage.getItem("pi-web-localization")).toBeNull();
    await service.setPreferences({ language: "en", formatLocale: "de-DE" });
    expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual({ language: "en", formatLocale: "de-DE" });
    dispose();
    release();
    const restored = new LocalizationService();
    dispose = await initializeLocalization(restored, window, false, { language: "ar", formatLocale: "ar-EG", timeZone: "UTC" });
    expect(restored.preferences).toEqual({ language: "en", formatLocale: "de-DE" });
    dispose();
  });

  it("uses updated gateway defaults on reload when no device choice exists", async () => {
    let service = new LocalizationService();
    let dispose = await initializeLocalization(service, window, false, { formatLocale: "de-DE" });
    expect(service.preferences.formatLocale).toBe("de-DE");
    dispose();
    service = new LocalizationService();
    dispose = await initializeLocalization(service, window, false, { formatLocale: "en-GB" });
    expect(service.preferences.formatLocale).toBe("en-GB");
    expect(service.preferences.language).toBe(navigator.languages[0] ?? navigator.language);
    expect(service.preferences.timeZone).toBeUndefined();
    dispose();
  });

  it("keeps development query overrides out of inherited defaults and saved user changes", async () => {
    const service = new LocalizationService({ development: true });
    const dispose = await initializeLocalization(service, { localStorage, document, navigator,
      location: { search: "?pseudoLocale=ar-XB" } }, true, { language: "fr", formatLocale: "de-DE" });
    expect(service.language).toBe("ar-XB");
    expect(localStorage.getItem("pi-web-localization")).toBeNull();
    await service.setPreferences({ ...service.preferences, hourCycle: "h12" });
    expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual({ language: "fr", formatLocale: "de-DE", hourCycle: "h12" });
    dispose();
  });

  it.each(["unchanged", "changed"])("keeps an explicit %s browser choice made while gateway defaults are pending", async (choice) => {
    let resolveDefaults: ((defaults: { formatLocale: string }) => void) | undefined;
    const pending = new Promise<{ formatLocale: string }>((resolve) => { resolveDefaults = resolve; });
    const service = new LocalizationService();
    const initialization = initializeLocalization(service, window, false, pending);
    await service.ready;
    await Promise.resolve();
    const selected = choice === "unchanged" ? { ...service.preferences } : { language: "en", formatLocale: "en-GB" };
    await service.setPreferences(selected);
    expect(JSON.parse(localStorage.getItem("pi-web-localization") ?? "null")).toEqual(selected);
    if (resolveDefaults === undefined) throw new Error("Missing defaults resolver");
    resolveDefaults({ formatLocale: "de-DE" });
    const dispose = await initialization;
    expect(service.preferences).toEqual(selected);
    dispose();
  });

  it("updates connected Lit hosts on locale changes and safely renders only caller-provided markup", async () => {
    const service = new LocalizationService({ development: true });
    const messages = service.registerMessages("test", {
      text: message<{ name: string; strong: RichMessageTag }>("Hello <strong>{name}</strong>", "Emphasized user name"),
    });
    class LocalizedTest extends LitElement {
      readonly localization = new LocalizationController(this, service);
      protected override render() {
        return html`<p>${messages.rich("text", { name: "<img src=x onerror=alert(1)>", strong: (parts) => html`<strong>${parts}</strong>` })}</p>`;
      }
    }
    customElements.define("localized-foundation-test", LocalizedTest);
    const element = new LocalizedTest();
    document.body.append(element);
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector("strong")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(element.shadowRoot?.querySelector("img")).toBeNull();
    await service.setPreferences({ language: "en-XA", formatLocale: "en" });
    await element.updateComplete;
    expect(element.shadowRoot?.textContent).toContain("Hëllö");
    element.remove();
    const requestUpdate = vi.spyOn(element, "requestUpdate");
    await service.setPreferences({ language: "en", formatLocale: "en" });
    expect(requestUpdate).not.toHaveBeenCalled();
    document.body.append(element);
    await element.updateComplete;
    expect(element.shadowRoot?.textContent).toContain("Hello");
    // Also prove the formatted text remains a text binding when used directly with Lit.
    render(messages.rich("text", { name: "<script>unsafe</script>", strong: (parts) => html`<b>${parts}</b>` }), document.body);
    expect(document.body.querySelector("script")).toBeNull();
  });
});
