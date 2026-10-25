import { parse } from "@formatjs/icu-messageformat-parser";
import { IntlMessageFormat, type Formatters } from "intl-messageformat";
import type { TemplateResult } from "lit";
import type {
  LocalizationDiagnostic, LocalizationPreferences, LocalizedMessages, MessageArguments,
  MessageDefinitions, MessageValues, TranslationCatalog, TranslationContribution,
} from "../../../shared/localization.js";
import { pseudoLocalize, validateCatalog, validateMessages } from "./catalog.js";

export { message } from "../../../shared/localization.js";
export type * from "../../../shared/localization.js";

interface RegisteredCatalog extends TranslationContribution {
  loaded?: Promise<TranslationCatalog>;
}

interface SelectedMessage { message: string; locale: string }

export interface LocalizationOptions {
  preferences?: LocalizationPreferences;
  /** Pseudo locales are a development facility, disabled in production. */
  development?: boolean;
  diagnostic?: (diagnostic: LocalizationDiagnostic) => void;
}

function canonicalLocale(locale: string): string {
  const canonical = Intl.getCanonicalLocales(locale)[0];
  if (canonical === undefined) throw new RangeError("A locale is required");
  return canonical;
}

function localeChain(locale: string): string[] {
  const parts = new Intl.Locale(locale).baseName.split("-");
  const result: string[] = [];
  while (parts.length) {
    result.unshift(parts.join("-"));
    parts.pop();
  }
  return result;
}

export function normalizePreferences(value: unknown): LocalizationPreferences {
  if (typeof value !== "object" || value === null || !("language" in value) || typeof value.language !== "string"
    || !("formatLocale" in value) || typeof value.formatLocale !== "string") throw new TypeError("Expected language and formatLocale");
  const language = canonicalLocale(value.language);
  const formatLocale = canonicalLocale(value.formatLocale);
  const hourCycle = "hourCycle" in value ? value.hourCycle : undefined;
  const zone = "timeZone" in value ? value.timeZone : undefined;
  if (hourCycle !== undefined && hourCycle !== "h11" && hourCycle !== "h12" && hourCycle !== "h23" && hourCycle !== "h24") {
    throw new RangeError("Invalid hour cycle");
  }
  if (zone !== undefined && typeof zone !== "string") throw new TypeError("Expected a time-zone name");
  // Native Intl validates zones; no locale-to-zone or locale-to-currency inference.
  const timeZone = zone === undefined ? undefined
    : new Intl.DateTimeFormat(formatLocale, { timeZone: zone }).resolvedOptions().timeZone;
  return { language, formatLocale, ...(timeZone === undefined ? {} : { timeZone }),
    ...(hourCycle === undefined ? {} : { hourCycle }) };
}

function hasTextInfoMethod(locale: Intl.Locale): locale is Intl.Locale & { getTextInfo(): unknown } {
  return "getTextInfo" in locale && typeof locale.getTextInfo === "function";
}

export function localeDirection(language: string): "ltr" | "rtl" {
  if (language === "ar-XB") return "rtl";
  const locale = new Intl.Locale(language);
  // Engines ship either the current method or the earlier accessor form.
  const info: unknown = hasTextInfoMethod(locale) ? locale.getTextInfo() : "textInfo" in locale ? locale.textInfo : undefined;
  return typeof info === "object" && info !== null && "direction" in info && info.direction === "rtl" ? "rtl" : "ltr";
}

/** Owns catalogs/preferences. Environment effects belong to the browser/plugin adapters. */
export class LocalizationService {
  private current: LocalizationPreferences;
  private readonly development: boolean;
  private readonly diagnostic: (diagnostic: LocalizationDiagnostic) => void;
  private readonly sources = new Map<string, MessageDefinitions>();
  private readonly contributions = new Map<string, RegisteredCatalog>();
  private readonly sourceOwners = new Map<string, { definitions: MessageDefinitions; count: number }>();
  private selected = new Map<string, Map<string, SelectedMessage>>();
  private readonly listeners = new Set<() => void>();
  private readonly formats = new Map<string, IntlMessageFormat>();
  private readonly reported = new Set<string>();
  private generation = 0;
  private preferencesRevision = 0;
  private pending: Promise<void> = Promise.resolve();
  private resolvedLanguage = "en";

  constructor(options: LocalizationOptions = {}) {
    this.current = normalizePreferences(options.preferences ?? { language: "en", formatLocale: "en" });
    this.development = options.development ?? false;
    this.diagnostic = options.diagnostic ?? ((diagnostic) => { console.warn(`[i18n:${diagnostic.code}] ${diagnostic.message}`, diagnostic.cause ?? ""); });
    this.assertLanguage(this.current.language);
  }

  get preferences(): Readonly<LocalizationPreferences> { return { ...this.current }; }
  /** Distinguishes explicit preference requests (even identical values) from catalog refreshes. */
  get preferenceRevision(): number { return this.preferencesRevision; }
  /** Actual UI language after catalog fallback, suitable for document.lang. */
  get language(): string { return this.isPseudo ? this.current.language : this.resolvedLanguage; }
  get direction(): "ltr" | "rtl" { return localeDirection(this.language); }
  get ready(): Promise<void> { return this.pending; }
  /** Installed catalog languages, without loading catalogs or exposing development pseudo modes. */
  get availableLanguages(): readonly string[] {
    return [...new Set(["en", ...[...this.contributions.values()].map((item) => item.locale)])]
      .filter((locale) => locale !== "en-XA" && locale !== "ar-XB").sort();
  }
  private get isPseudo(): boolean { return this.current.language === "en-XA" || this.current.language === "ar-XB"; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    this.formats.clear();
    for (const listener of this.listeners) listener();
  }

  private report(code: LocalizationDiagnostic["code"], message: string, cause?: unknown): void {
    const key = `${code}:${message}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.diagnostic({ code, message, ...(cause === undefined ? {} : { cause }) });
  }

  private assertLanguage(language: string): void {
    if (!this.development && (language === "en-XA" || language === "ar-XB")) {
      throw new RangeError("Pseudo-localization is available only in development");
    }
  }

  setPreferences(preferences: LocalizationPreferences): Promise<void> {
    const normalized = normalizePreferences(preferences);
    this.assertLanguage(normalized.language);
    this.current = normalized;
    this.preferencesRevision++;
    return this.refresh();
  }

  /** Register one namespace's English source; keys remain local to its typed handle. */
  registerMessages<Definitions extends MessageDefinitions>(namespace: string, definitions: Definitions): LocalizedMessages<Definitions> {
    if (!namespace || this.sources.has(namespace)) throw new Error(`Duplicate or empty message namespace: ${namespace}`);
    const errors = validateMessages(definitions);
    if (errors.length) throw new Error(`Invalid source ${namespace}: ${errors.join("; ")}`);
    this.sources.set(namespace, definitions);
    void this.refresh();
    return this.messageHandle<Definitions>(namespace);
  }

  /** Shared package sources survive until their last federated activation releases them. */
  acquireMessages<Definitions extends MessageDefinitions>(namespace: string, definitions: Definitions): {
    messages: LocalizedMessages<Definitions>; release(): void;
  } {
    let owner = this.sourceOwners.get(namespace);
    if (owner === undefined) {
      this.registerMessages(namespace, definitions);
      owner = { definitions, count: 0 };
      this.sourceOwners.set(namespace, owner);
    } else {
      const existing = owner.definitions;
      const keys = Object.keys(definitions);
      if (keys.length !== Object.keys(existing).length || keys.some((key) => {
        const source = existing[key];
        return source?.message !== definitions[key]?.message || source?.description !== definitions[key]?.description;
      })) throw new Error(`Conflicting source messages: ${namespace}`);
    }
    const acquiredOwner = owner;
    acquiredOwner.count++;
    let released = false;
    return {
      // Detached Lit hosts may finish a queued render after activation cleanup.
      // Keep reads safe without retaining registrations or another owner's catalog.
      messages: this.messageHandle<Definitions>(namespace, () => released ? definitions : undefined),
      release: () => {
        if (released) return;
        released = true;
        if (--acquiredOwner.count !== 0) return;
        this.sourceOwners.delete(namespace);
        this.sources.delete(namespace);
        void this.refresh();
      },
    };
  }

  private messageHandle<Definitions extends MessageDefinitions>(namespace: string, detachedDefinitions?: () => Definitions | undefined): LocalizedMessages<Definitions> {
    return {
      t: <Key extends keyof Definitions & string>(key: Key, ...args: MessageArguments<Definitions[Key]>) => {
        const result = this.format(namespace, key, args[0], detachedDefinitions?.());
        if (typeof result !== "string") throw new Error(`Use rich() for ${namespace}.${key}`);
        return result;
      },
      rich: <Key extends keyof Definitions & string>(key: Key, ...args: MessageArguments<Definitions[Key]>) => this.format(namespace, key, args[0], detachedDefinitions?.()),
    };
  }

  /** Contributions may target any namespace; registration order and load timing do not determine precedence. */
  registerCatalog(contribution: TranslationContribution): () => void {
    if (!contribution.id || this.contributions.has(contribution.id)) throw new Error(`Duplicate or empty catalog ID: ${contribution.id}`);
    const registered: RegisteredCatalog = { ...contribution, locale: canonicalLocale(contribution.locale) };
    this.contributions.set(registered.id, registered);
    void this.refresh();
    return () => {
      if (this.contributions.get(registered.id) !== registered) return;
      this.contributions.delete(registered.id);
      void this.refresh();
    };
  }

  private refresh(): Promise<void> {
    const generation = ++this.generation;
    const language = this.current.language;
    const chain = this.isPseudo ? [] : localeChain(language).filter((locale) => locale !== "en");
    const contributions = [...this.contributions.values()]
      .filter((item) => chain.includes(item.locale))
      .sort((a, b) => chain.indexOf(a.locale) - chain.indexOf(b.locale) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.pending = (async () => {
      const loaded = await Promise.all(contributions.map(async (item) => {
        // Promise.resolve catches synchronous loader failures as well as rejected promises.
        item.loaded ??= Promise.resolve().then(() => item.load()).then((catalog: unknown) => {
          if (typeof catalog !== "object" || catalog === null || Array.isArray(catalog)) {
            throw new TypeError("Expected a translation catalog object");
          }
          // One bad message must not discard valid siblings.
          const entries: [string, string][] = [];
          for (const [key, value] of Object.entries(catalog)) {
            if (typeof value === "string") entries.push([key, value]);
            else this.report("invalid", `${item.id}: ${key}: expected an ICU string`);
          }
          return Object.fromEntries(entries);
        }).catch((cause: unknown) => {
          this.report("load", `Could not load ${item.id} (${item.locale}/${item.namespace})`, cause);
          return {};
        });
        return { item, catalog: await item.loaded };
      }));
      if (generation !== this.generation) return;
      const selected = new Map<string, Map<string, SelectedMessage>>();
      const owners = new Map<string, string>();
      let resolvedLanguage = "en";
      for (const { item, catalog } of loaded) {
        const source = this.sources.get(item.namespace);
        // Language packs can arrive before the plugin owning their target namespace.
        if (!source) continue;
        for (const [key, value] of Object.entries(catalog)) {
          const errors = validateCatalog(source, { [key]: value });
          if (errors.length) {
            this.report("invalid", `${item.id}: ${errors.join("; ")}`);
            continue;
          }
          const identity = JSON.stringify([item.locale, item.namespace, key]);
          const owner = owners.get(identity);
          if (owner !== undefined) this.report("duplicate", `${item.locale}/${item.namespace}.${key}: ${item.id} overrides ${owner}`);
          owners.set(identity, item.id);
          let namespace = selected.get(item.namespace);
          if (!namespace) { namespace = new Map(); selected.set(item.namespace, namespace); }
          namespace.set(key, { message: value, locale: item.locale });
          resolvedLanguage = item.locale;
        }
      }
      this.selected = selected;
      this.resolvedLanguage = resolvedLanguage;
      this.notify();
    })();
    return this.pending;
  }

  private dateOptions(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
    return { ...options, ...(this.current.timeZone === undefined ? {} : { timeZone: this.current.timeZone }),
      ...(this.current.hourCycle === undefined ? {} : { hourCycle: this.current.hourCycle, hour12: undefined }) };
  }

  private format(namespace: string, key: string, values?: MessageValues, detachedDefinitions?: MessageDefinitions): string | TemplateResult | (string | TemplateResult)[] {
    const source = (detachedDefinitions ?? this.sources.get(namespace))?.[key];
    if (!source) throw new Error(`Unknown message: ${namespace}.${key}`);
    const translated = detachedDefinitions === undefined ? this.selected.get(namespace)?.get(key) : undefined;
    if (!translated && detachedDefinitions === undefined && !this.isPseudo && !this.current.language.startsWith("en") && this.development) {
      this.report("missing", `${this.current.language}/${namespace}.${key}: using English`);
    }
    const selected = this.isPseudo ? { message: source.message, locale: "en" } : translated ?? { message: source.message, locale: "en" };
    const format = (text: string, locale: string): string | TemplateResult | (string | TemplateResult)[] => {
      const cacheKey = JSON.stringify([namespace, key, text, locale, this.isPseudo]);
      let formatter = this.formats.get(cacheKey);
      if (!formatter) {
        const formatters: Formatters = {
          // FormatJS includes newer Intl option types than our ES2022 lib; pass them through to native Intl.
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          getNumberFormat: (_locale, options) => new Intl.NumberFormat(this.current.formatLocale, options as Intl.NumberFormatOptions),
          getDateTimeFormat: (_locale, options) => new Intl.DateTimeFormat(this.current.formatLocale, this.dateOptions(options ?? {})),
          getPluralRules: (pluralLocale, options) => new Intl.PluralRules(pluralLocale, options),
        };
        let ast = parse(text);
        if (this.isPseudo) ast = pseudoLocalize(ast, this.current.language === "ar-XB");
        formatter = new IntlMessageFormat(ast, locale, undefined, { formatters });
        this.formats.set(cacheKey, formatter);
      }
      return formatter.format<TemplateResult>(values);
    };
    try { return format(selected.message, selected.locale); }
    catch (cause) {
      this.report("format", `${namespace}.${key}: formatting failed`, cause);
      // A broken translation cannot hide a usable source. Caller errors still throw clearly.
      if (selected.message !== source.message) return format(source.message, "en");
      throw cause;
    }
  }

  number(value: number | bigint, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.current.formatLocale, options).format(value);
  }
  date(value: Date | number, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
    return new Intl.DateTimeFormat(this.current.formatLocale, this.dateOptions(options)).format(value);
  }
  time(value: Date | number, options: Intl.DateTimeFormatOptions = { timeStyle: "short" }): string {
    return new Intl.DateTimeFormat(this.current.formatLocale, this.dateOptions(options)).format(value);
  }
  relativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, options: Intl.RelativeTimeFormatOptions = { numeric: "auto" }): string {
    return new Intl.RelativeTimeFormat(this.current.formatLocale, options).format(value, unit);
  }
  list(values: Iterable<string>, options?: Intl.ListFormatOptions): string {
    return new Intl.ListFormat(this.current.formatLocale, options).format(values);
  }
}
