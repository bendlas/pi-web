import "./components/PiWebApp";
import { initializeLocalization } from "./localization/browser.js";

void initializeLocalization().catch((cause: unknown) => {
  console.error("[i18n] Localization startup failed", cause);
});
