# Localization development

PI WEB's localization engine uses FormatJS ICU messages and the runtime's native `Intl` data. English is the source and fallback language. The engine and browser adapter are available; migration of core UI and bundled plugins is in progress. The browser plugin context does not yet expose this API.

## Define complete messages

Keep source definitions in `*.messages.ts` modules with a default export. These modules contain definitions only, without browser effects or registration. CI discovers core and bundled-plugin source files by this convention and validates ICU syntax and translator descriptions.

```ts
import { message } from "../localization/service.js";

export default {
  files: message<{ count: number }>(
    "{count, plural, one {# file} other {# files}}",
    "Number of files in the current folder",
  ),
  cancel: message("Cancel", "Cancel the current operation"),
};
```

Register the definitions once in the owning module, outside the definition file:

```ts
import definitions from "./files.messages.js";
import { localization } from "../localization/browser.js";

export const filesMessages = localization.registerMessages("core.files", definitions);
filesMessages.t("files", { count: 3 });
filesMessages.t("cancel");
```

Keys and explicitly declared value types are checked by TypeScript. ICU structure is checked at runtime and in the source-validation test. Supply the full message, not concatenated translated fragments. Use ICU `plural`, `selectordinal`, and `select` for grammatical alternatives. Keep user content, model responses, code, paths, and identifiers in interpolation values; never use them as source messages or translation keys.

Add `new LocalizationController(this)` to each localized Lit component (import from `localization/browser.js`). It requests updates when preferences or catalogs change, unsubscribes on disconnection, and reconnects automatically. Non-Lit consumers can use `localization.subscribe(listener)` and must call the returned cleanup function.

## Format regional values

Use `localization.number(value, options)`, `date(value, options)`, `time(value, options)`, `relativeTime(value, unit, options)`, and `list(values, options)`. They use native `Intl` formatting. ICU number/date/time arguments use the same regional preferences; plural rules use the language of the selected message, including English fallback.

Preferences are independent:

```ts
await localization.setPreferences({
  language: "fr-CA",
  formatLocale: "de-DE",
  timeZone: "America/Toronto",
  hourCycle: "h23",
});
```

`language` requests the UI catalog; `formatLocale` selects regional conventions. The browser initially supplies both. Omit `timeZone` for the runtime's local zone and `hourCycle` for the regional default. Explicit preferences override individual date/time formatting options. Currency must always be supplied explicitly, for example `{ style: "currency", currency: "CAD" }`; it is never inferred from a locale.

The browser adapter persists preferences under `pi-web-localization` in browser storage. It updates document language to the resolved UI language (English when no translated catalog is available) and direction from native locale data. `service.preferences.language` retains the requested language even when catalogs are unavailable. This currently has no settings UI.

## Contribute translations

The engine accepts lazy translation contributions. Browser plugin lifecycle wiring is still pending; this example describes the engine contract, not an available plugin context property:

```ts
const remove = localization.registerCatalog({
  id: "my-language-pack:core-files-fr",
  namespace: "core.files",
  locale: "fr",
  load: () => import("./fr.js").then((module) => module.default),
});
await localization.ready;
// On owner disposal:
remove();
await localization.ready;
```

A catalog is a partial map from local message keys to ICU strings. Contributions can target their own namespace, core, or another plugin. They may arrive before their target source namespace. Catalogs load only when their locale belongs to the requested UI-language fallback chain; each registered loader runs at most once, including failed loaders. To retry a failed load, remove and register it again. Removing a contribution restores the next matching translation or English.

Resolution is deterministic: less-specific locales apply first (`fr` before `fr-CA`); within one locale, contributions sort by stable ID using code-unit lexical order, with later IDs winning overlapping entries. Completion timing and registration order do not determine the winner. IDs must be globally unique. Duplicate *message entries* are allowed and logged only, without user-visible conflict warnings.

Invalid entries are logged and ignored individually. Placeholder/tag names and value kinds must match the source; translated plurals can use different categories. Loader failures are logged and fall back to English or another valid contribution. Missing-message diagnostics are development-only. The exported `validateCatalog(source, catalog)` helper in `localization/catalog.js` supports catalog-author tests; runtime validation also protects dynamically loaded catalogs.

## Safe rich messages

Use named ICU tags and caller-owned Lit callbacks, never translated HTML or `unsafeHTML`:

```ts
import { html } from "lit";
import { message, type RichMessageTag } from "../localization/service.js";

const definitions = {
  notice: message<{ name: string; strong: RichMessageTag }>(
    "Open <strong>{name}</strong>",
    "Emphasized file name in an opening notice",
  ),
};
const messages = localization.registerMessages("example", definitions);
messages.rich("notice", {
  name: fileName,
  strong: (parts) => html`<strong>${parts}</strong>`,
});
```

The application owns elements and attributes. Translation validation rejects new tag names and attributes; interpolation values remain text bindings in Lit. `t()` is for plain text; use `rich()` when callbacks return templates.

## Pseudo-localization

In a Vite development build, open the application with `?pseudoLocale=en-XA` for expanded accented text or `?pseudoLocale=ar-XB` for right-to-left text and document direction. Preserve any existing query values when adding the parameter. The query override does not persist a pseudo language preference. Production services reject pseudo locales.

Pseudo-localization transforms only English literal ICU nodes, including branches and tag contents. Interpolated paths, user text, numbers, and code remain unchanged. It exercises only migrated messages; untranslated legacy UI is not automatically transformed. As areas migrate, check long labels, wrapping, narrow layouts, keyboard navigation, and logical start/end positioning in both modes.

## Checks

Run `npm test -- src/client/src/localization` for engine, browser/Lit integration, and automatic English source validation. Add translation validation tests beside language-pack catalogs. Follow the repository's scoped lint, typecheck, and delivery-check guidance for changes to the implementation.
