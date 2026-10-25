import { describe, expect, it, vi } from "vitest";
import { html, type TemplateResult } from "lit";
import { LocalizationService, message, normalizePreferences, type LocalizationDiagnostic, type MessageDefinitions, type RichMessageTag } from "./service.js";
import { validateCatalog, validateMessages } from "./catalog.js";

const definitions = {
  greeting: message<{ name: string }>("Hello {name}", "Welcome a user by name"),
  files: message<{ count: number }>("{count, plural, one {# file} other {# files}}", "Number of files"),
  status: message<{ state: string }>("{state, select, ready {Ready} other {Waiting}}", "Task status"),
  rich: message<{ strong: RichMessageTag; name: string }>(
    "Read <strong>{name}</strong>", "Emphasized document title"),
  price: message<{ amount: number }>("Total: {amount, number, ::currency/USD}", "Price in explicitly specified US dollars"),
  date: message<{ at: Date }>("{at, time, short}", "Event time"),
  cancel: message("Cancel", "Cancel the current operation"),
} satisfies MessageDefinitions;

function setup(language = "en", development = true) {
  const diagnostics: LocalizationDiagnostic[] = [];
  const service = new LocalizationService({ preferences: { language, formatLocale: "de-DE", timeZone: "UTC", hourCycle: "h23" },
    development, diagnostic: (diagnostic) => diagnostics.push(diagnostic) });
  const messages = service.registerMessages("test", definitions);
  return { service, messages, diagnostics };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("localization", () => {
  it("lists installed catalog languages without loading, deduplicates, and removes released languages", async () => {
    const { service } = setup();
    const load = vi.fn(() => Promise.resolve({}));
    const remove = service.registerCatalog({ id: "de-a", namespace: "test", locale: "de-de", load });
    service.registerCatalog({ id: "de-b", namespace: "other", locale: "de-DE", load });
    const removeFrench = service.registerCatalog({ id: "fr", namespace: "other", locale: "fr", load });
    service.registerCatalog({ id: "pseudo", namespace: "test", locale: "ar-XB", load });
    await service.ready;
    expect(service.availableLanguages).toEqual(["de-DE", "en", "fr"]);
    expect(load).not.toHaveBeenCalled();
    remove();
    removeFrench();
    expect(service.availableLanguages).toEqual(["de-DE", "en"]);
  });

  it("formats ICU interpolation, selects, plurals and rich callbacks without translating values", async () => {
    const { service, messages } = setup();
    await service.ready;
    expect(messages.t("greeting", { name: "/home/user.ts" })).toBe("Hello /home/user.ts");
    expect(messages.t("files", { count: 1 })).toBe("1 file");
    expect(messages.t("files", { count: 1200 })).toBe("1.200 files");
    expect(messages.t("status", { state: "ready" })).toBe("Ready");
    const strong = vi.fn((parts: (string | TemplateResult)[]) => html`<strong>${parts}</strong>`);
    const result = messages.rich("rich", { name: "<script>user</script>", strong });
    expect(strong).toHaveBeenCalledWith(["<script>user</script>"]);
    expect(Array.isArray(result)).toBe(true);
    expect(messages.t("cancel")).toBe("Cancel");
  });

  it("keeps UI plural rules independent of regional number/date preferences", async () => {
    const { service, messages } = setup("fr");
    service.registerCatalog({ id: "plugin:fr", namespace: "test", locale: "fr", load: () => Promise.resolve({ files: "{count, plural, one {# fichier} other {# fichiers}}" }) });
    await service.ready;
    expect(messages.t("files", { count: 0 })).toBe("0 fichier");
    // Missing translations use English plural semantics, not the requested French rules.
    expect(messages.t("greeting", { name: "Ada" })).toBe("Hello Ada");
    expect(messages.t("price", { amount: 1200.5 })).toBe(`Total: ${new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD" }).format(1200.5)}`);
    const at = new Date("2026-01-01T17:45:00Z");
    expect(messages.t("date", { at })).toBe("17:45");
    expect(service.number(1200.5)).toBe(new Intl.NumberFormat("de-DE").format(1200.5));
    expect(service.date(at)).toBe(new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC", hourCycle: "h23" }).format(at));
    expect(service.time(at)).toBe("17:45");
    expect(service.relativeTime(-1, "day")).toBe(new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" }).format(-1, "day"));
    expect(service.list(["A", "B"])).toBe(new Intl.ListFormat("de-DE").format(["A", "B"]));
  });

  it("composes lazy catalogs deterministically, falls back by locale, and removes contributions", async () => {
    const { service, messages, diagnostics } = setup();
    const slow = deferred<Record<string, string>>();
    const load = vi.fn(() => slow.promise);
    const removeZ = service.registerCatalog({ id: "z-pack", namespace: "test", locale: "fr", load });
    service.registerCatalog({ id: "a-plugin", namespace: "test", locale: "fr", load: () => Promise.resolve({ cancel: "Annuler A", greeting: "Bonjour {name}" }) });
    service.registerCatalog({ id: "a-ca", namespace: "test", locale: "fr-CA", load: () => Promise.resolve({ greeting: "Salut {name}" }) });
    await service.ready;
    expect(load).not.toHaveBeenCalled();
    const ready = service.setPreferences({ language: "fr-CA", formatLocale: "en-GB" });
    slow.resolve({ cancel: "Annuler Z" });
    await ready;
    expect(messages.t("cancel")).toBe("Annuler Z");
    expect(messages.t("greeting", { name: "Ada" })).toBe("Salut Ada");
    expect(service.language).toBe("fr-CA");
    expect(diagnostics.filter(({ code }) => code === "duplicate")).toHaveLength(1);
    removeZ();
    await service.ready;
    expect(messages.t("cancel")).toBe("Annuler A");
    await service.setPreferences({ language: "en", formatLocale: "en" });
    await service.setPreferences({ language: "fr", formatLocale: "en" });
    expect(load).toHaveBeenCalledOnce();
  });

  it("ignores stale asynchronous loads after switching languages or disposing a catalog", async () => {
    const { service, messages } = setup();
    const slow = deferred<Record<string, string>>();
    const remove = service.registerCatalog({ id: "fr", namespace: "test", locale: "fr", load: () => slow.promise });
    const french = service.setPreferences({ language: "fr", formatLocale: "en" });
    await service.setPreferences({ language: "en", formatLocale: "en" });
    remove();
    slow.resolve({ cancel: "Annuler" });
    await french;
    await service.ready;
    expect(messages.t("cancel")).toBe("Cancel");
    expect(service.language).toBe("en");
  });

  it("isolates failed loaders and invalid messages, logging rather than surfacing conflicts to users", async () => {
    const { service, messages, diagnostics } = setup("fr");
    service.registerCatalog({ id: "broken", namespace: "test", locale: "fr", load: () => Promise.reject(new Error("offline")) });
    service.registerCatalog({ id: "invalid", namespace: "test", locale: "fr", load: () => Promise.resolve({ greeting: "Bonjour {wrong}", rich: "<script>{name}</script>", cancel: "Annuler" }) });
    await service.ready;
    expect(messages.t("greeting", { name: "Ada" })).toBe("Hello Ada");
    expect(messages.t("cancel")).toBe("Annuler");
    expect(diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(["load", "invalid", "missing"]));
    expect(diagnostics.filter(({ code }) => code === "invalid")).toHaveLength(2);
    messages.t("greeting", { name: "Ada" });
    expect(diagnostics.filter(({ code }) => code === "missing")).toHaveLength(1);
  });

  it("supports packs registered before their target namespace", async () => {
    const service = new LocalizationService({ preferences: { language: "fr", formatLocale: "fr" } });
    service.registerCatalog({ id: "pack", namespace: "later", locale: "fr", load: () => Promise.resolve({ cancel: "Annuler" }) });
    await service.ready;
    const messages = service.registerMessages("later", { cancel: definitions.cancel });
    await service.ready;
    expect(messages.t("cancel")).toBe("Annuler");
  });

  it("pseudo-localizes English literals only, including ICU branches and rich messages", async () => {
    const { service, messages } = setup();
    await service.setPreferences({ language: "en-XA", formatLocale: "en" });
    expect(messages.t("greeting", { name: "/home/user.ts" })).toContain("/home/user.ts");
    expect(messages.t("greeting", { name: "Ada" })).toContain("Hëllö");
    expect(messages.t("files", { count: 2 })).toContain("fïlës");
    expect(messages.t("cancel").length).toBeGreaterThan("Cancel".length);
    expect(service.direction).toBe("ltr");
    await service.setPreferences({ language: "ar-XB", formatLocale: "en" });
    expect(service.direction).toBe("rtl");
    expect(messages.t("cancel")).toContain("\u202e");
    expect(() => setup("en-XA", false)).toThrow(/development/);
  });

  it("validates preferences before mutating state and gives subscribers an explicit cleanup", async () => {
    const { service } = setup();
    await service.ready;
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    const original = service.preferences;
    expect(() => service.setPreferences({ language: "en", formatLocale: "en", timeZone: "Not/AZone" })).toThrow();
    expect(service.preferences).toEqual(original);
    await service.setPreferences({ language: "en", formatLocale: "en-GB" });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    await service.setPreferences({ language: "en", formatLocale: "de" });
    expect(listener).toHaveBeenCalledOnce();
    expect(normalizePreferences({ language: "EN-us", formatLocale: "de-de" })).toEqual({ language: "en-US", formatLocale: "de-DE" });
  });

  it("rejects invalid source catalogs and validates translation placeholders/tags", () => {
    expect(validateMessages({ bad: message("{unclosed", "") })).toHaveLength(2);
    expect(validateCatalog(definitions, { unknown: "Unknown", greeting: "Hi {other}", rich: "<em>{name}</em>" })).toHaveLength(3);
    expect(validateCatalog(definitions, { files: "{count, plural, few {# items} other {# items}}" })).toEqual([]);
    const { service } = setup();
    expect(() => service.registerMessages("invalid", { bad: message("{", "Invalid") })).toThrow(/Invalid source/);
  });
});

// Compile-time API contract: unknown keys and missing/wrong placeholders must fail typechecking.
function typeContract(messages: ReturnType<typeof setup>["messages"]): void {
  messages.t("cancel");
  messages.t("files", { count: 2 });
  // @ts-expect-error unknown message key
  messages.t("unknown");
  // @ts-expect-error missing required values
  messages.t("greeting");
  // @ts-expect-error wrong value type
  messages.t("files", { count: "two" });
  // @ts-expect-error unknown placeholder
  messages.t("greeting", { name: "Ada", extra: "unexpected" });
}
void typeContract;
