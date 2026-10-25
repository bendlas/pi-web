import "./components/PiWebApp";
import { initializeLocalization } from "./localization/browser.js";
import { configApi } from "./api.js";

// Defaults belong to the gateway, not whichever machine/workspace is selected.
// Browser-local preferences remain usable while the request is pending or fails.
const defaults = configApi.config().then((response) => response.effectiveConfig.defaultLocalization).catch((cause: unknown) => {
  console.warn("[i18n] Could not load gateway localization defaults; using browser preferences", cause);
  return undefined;
});
void initializeLocalization(undefined, window, undefined, defaults).catch((cause: unknown) => {
  console.error("[i18n] Localization startup failed", cause);
});
