import type { ReactiveController, ReactiveControllerHost } from "lit";
import { LocalizationService, normalizePreferences, type LocalizationPreferences } from "./service.js";

const STORAGE_KEY = "pi-web-localization";
export const localization = new LocalizationService({ development: import.meta.env.DEV });

/** Explicit startup boundary; importing localization never reads browser globals or attaches listeners. */
export async function initializeLocalization(
  service = localization,
  environment: Pick<Window, "localStorage" | "navigator" | "document"> & { location: Pick<Location, "search"> } = window,
  development = import.meta.env.DEV,
): Promise<() => void> {
  const browserLocale = environment.navigator.languages[0] ?? environment.navigator.language;
  let preferences: LocalizationPreferences = { language: browserLocale, formatLocale: browserLocale };
  try {
    const stored = environment.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) preferences = normalizePreferences(JSON.parse(stored));
  } catch (cause) {
    console.warn("[i18n] Could not restore localization preferences; using browser defaults", cause);
  }
  if (development) {
    const pseudo = new URLSearchParams(environment.location.search).get("pseudoLocale");
    if (pseudo === "en-XA" || pseudo === "ar-XB") preferences = { ...preferences, language: pseudo };
  } else if (preferences.language === "en-XA" || preferences.language === "ar-XB") {
    preferences = { ...preferences, language: browserLocale };
  }
  await service.setPreferences(preferences);
  const update = (): void => {
    environment.document.documentElement.lang = service.language;
    environment.document.documentElement.dir = service.direction;
    try {
      // Query-selected pseudo locales must not replace the user's saved UI language.
      const current = service.preferences;
      const language = current.language === "en-XA" || current.language === "ar-XB" ? preferences.language : current.language;
      if (language !== "en-XA" && language !== "ar-XB") environment.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, language }));
    } catch (cause) { console.warn("[i18n] Could not save localization preferences", cause); }
  };
  update();
  return service.subscribe(update);
}

/** Add to every localized Lit host; disconnected hosts release their subscription. */
export class LocalizationController implements ReactiveController {
  private unsubscribe: (() => void) | undefined;
  constructor(private readonly host: ReactiveControllerHost, readonly service: Pick<LocalizationService, "subscribe"> = localization) {
    host.addController(this);
  }
  hostConnected(): void {
    this.unsubscribe ??= this.service.subscribe(() => { this.host.requestUpdate(); });
    this.host.requestUpdate();
  }
  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
