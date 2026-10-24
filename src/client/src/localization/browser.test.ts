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
