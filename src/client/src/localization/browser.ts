import type { ReactiveController, ReactiveControllerHost } from "lit";
import { LocalizationService, normalizePreferences, type LocalizationPreferences } from "./service.js";

const STORAGE_KEY = "pi-web-localization";
export const localization = new LocalizationService({ development: import.meta.env.DEV });

/** Snapshot browser defaults without inferring a time zone or currency from a locale. */
export function browserLocalizationPreferences(navigator: Pick<Navigator, "languages" | "language"> = window.navigator): LocalizationPreferences {
  const locale = navigator.languages[0] ?? navigator.language;
  return { language: locale, formatLocale: locale };
}

/** Explicit startup boundary; importing localization never reads browser globals or attaches listeners. */
export async function initializeLocalization(
  service = localization,
  environment: Pick<Window, "localStorage" | "navigator" | "document"> & { location: Pick<Location, "search"> } = window,
  development = import.meta.env.DEV,
  configuredDefaults: Partial<LocalizationPreferences> | Promise<Partial<LocalizationPreferences> | undefined> = {},
): Promise<() => void> {
  const defaults = browserLocalizationPreferences(environment.navigator);
  const browserLocale = defaults.language;
  let preferences = defaults;
  let hasOverride = false;
  try {
    const stored = environment.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      preferences = normalizePreferences(JSON.parse(stored));
      hasOverride = true;
    }
  } catch (cause) {
    console.warn("[i18n] Could not restore localization preferences; using browser defaults", cause);
  }
  let savedLanguage = preferences.language;
  if (development) {
    const pseudo = new URLSearchParams(environment.location.search).get("pseudoLocale");
    if (pseudo === "en-XA" || pseudo === "ar-XB") preferences = { ...preferences, language: pseudo };
  } else if (preferences.language === "en-XA" || preferences.language === "ar-XB") {
    preferences = { ...preferences, language: browserLocale };
  }
  await service.setPreferences(preferences);
  let previousRevision = service.preferenceRevision;
  let inheritedRevision: number | undefined;
  const update = (): void => {
    environment.document.documentElement.lang = service.language;
    environment.document.documentElement.dir = service.direction;
    const current = service.preferences;
    const revision = service.preferenceRevision;
    if (revision === previousRevision) return;
    previousRevision = revision;
    if (revision === inheritedRevision) return;
    hasOverride = true;
    try {
      // Only explicit preference changes persist: startup/catalog updates must not
      // turn inherited gateway/browser defaults into a permanent device override.
      const language = current.language === "en-XA" || current.language === "ar-XB" ? savedLanguage : current.language;
      if (language !== "en-XA" && language !== "ar-XB") environment.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, language }));
    } catch (cause) { console.warn("[i18n] Could not save localization preferences", cause); }
  };
  update();
  const unsubscribe = service.subscribe(update);
  try {
    const configured = await configuredDefaults;
    // Keep the app usable while the gateway responds. An explicit user change
    // made during that request wins, just like an existing stored snapshot.
    if (!hasOverride && configured !== undefined) {
      const inherited = normalizePreferences({ ...defaults, ...configured });
      savedLanguage = inherited.language;
      const pseudo = development ? new URLSearchParams(environment.location.search).get("pseudoLocale") : null;
      const next = normalizePreferences({ ...inherited, ...(pseudo === "en-XA" || pseudo === "ar-XB" ? { language: pseudo } : {}) });
      inheritedRevision = service.preferenceRevision + 1;
      await service.setPreferences(next);
    }
  } catch (cause) {
    unsubscribe();
    throw cause;
  } finally {
    inheritedRevision = undefined;
  }
  return unsubscribe;
}

/** Add to every localized Lit host; disconnected hosts release their subscription. */
export class LocalizationController implements ReactiveController {
  private unsubscribe: (() => void) | undefined;
  constructor(
    private readonly host: ReactiveControllerHost,
    readonly service: Pick<LocalizationService, "subscribe"> = localization,
    private readonly invalidate?: () => void,
  ) {
    host.addController(this);
  }
  hostConnected(): void {
    this.unsubscribe ??= this.service.subscribe(() => { this.invalidate?.(); this.host.requestUpdate(); });
    // Guarded/cached surfaces also need invalidation after a disconnected locale change.
    this.invalidate?.();
    this.host.requestUpdate();
  }
  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
