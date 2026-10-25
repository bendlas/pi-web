import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { browserLocalizationPreferences, localization, LocalizationController } from "../../localization/browser";
import { normalizePreferences, type LocalizationPreferences } from "../../localization/service";
import { stylesheetIntegrationCapability } from "../../plugins/styles";
import { uiButtonStyles } from "../ui/controlStyles";
import { uiFormStyles } from "../ui/formStyles";
import { uiSettingsStyles } from "../ui/settingsStyles";
import source from "./settingsLocalization.messages";

export const localizationSettingsMessages = localization.registerMessages("core.settingsLocalization", source);
const messages = localizationSettingsMessages;
interface Draft { language: string; formatLocale: string; timeZone: string; hourCycle: string }
type Field = keyof Draft;
interface Validation { field: Field; key: "invalidLanguage" | "invalidRegion" | "invalidZone" | "invalidHours" }
function draftFromPreferences(value: Readonly<LocalizationPreferences>): Draft {
  return { language: value.language, formatLocale: value.formatLocale, timeZone: value.timeZone ?? "", hourCycle: value.hourCycle ?? "" };
}
function sameDraft(a: Draft, b: Draft): boolean {
  return a.language === b.language && a.formatLocale === b.formatLocale && a.timeZone === b.timeZone && a.hourCycle === b.hourCycle;
}
function validateDraft(draft: Draft): Validation | undefined {
  for (const [field, key] of [["language", "invalidLanguage"], ["formatLocale", "invalidRegion"]] as const) {
    try { if (Intl.getCanonicalLocales(draft[field].trim())[0] === undefined) return { field, key }; }
    catch { return { field, key }; }
  }
  try { new Intl.DateTimeFormat("en", draft.timeZone.trim() ? { timeZone: draft.timeZone.trim() } : {}); }
  catch { return { field: "timeZone", key: "invalidZone" }; }
  if (!["", "h11", "h12", "h23", "h24"].includes(draft.hourCycle)) return { field: "hourCycle", key: "invalidHours" };
  return undefined;
}

/** Browser-owned preferences are independent of gateway/selected-machine config and availability. */
@customElement("settings-localization-panel")
export class SettingsLocalizationPanel extends LitElement {
  private baseline = draftFromPreferences(localization.preferences);
  @state() private draft = { ...this.baseline };
  @state() private validation: Validation | undefined;
  @state() private failure: string | undefined;
  @state() private applying = false;
  @state() private saved = false;
  private readonly previewDate = new Date();

  constructor() {
    super();
    new LocalizationController(this);
    stylesheetIntegrationCapability.createController(this);
  }

  protected override willUpdate(): void {
    const incoming = draftFromPreferences(localization.preferences);
    if (!sameDraft(incoming, this.baseline)) {
      if (sameDraft(this.draft, this.baseline)) this.draft = incoming;
      this.baseline = incoming;
    }
  }

  protected override updated(): void {
    // Apply values after options exist, including options added by a live language pack.
    const language = this.renderRoot.querySelector<HTMLSelectElement>("#language");
    const hours = this.renderRoot.querySelector<HTMLSelectElement>("#hourCycle");
    if (language) language.value = this.draft.language;
    if (hours) hours.value = this.draft.hourCycle;
  }

  override render(): TemplateResult {
    const languages = [...new Set([...localization.availableLanguages, this.draft.language])];
    const displayNames = new Intl.DisplayNames([localization.language], { type: "language" });
    return html`
      <section class="ui-settings-section" aria-labelledby="localization-heading">
        <header class="ui-settings-heading">
          <h3 id="localization-heading">${messages.t("heading")}</h3>
          <p>${messages.t("description")}</p>
        </header>
        <form class="ui-settings-fields" novalidate @submit=${(event: Event) => { event.preventDefault(); void this.apply(this.draft); }}>
          <label class="ui-form-field" for="language">
            <span>${messages.t("language")}</span>
            <select id="language" class="ui-input" aria-describedby=${this.helpIds("language", "language-help")} aria-invalid=${this.validation?.field === "language" ? "true" : nothing} ?disabled=${this.applying}
              @change=${(event: Event) => { this.edit("language", event); }}>
              ${languages.map((code) => html`<option value=${code} ?selected=${code === this.draft.language}>${messages.t("languageOption", { name: displayNames.of(code) ?? code, code })}</option>`)}
            </select>
            <small id="language-help">${messages.t("languageHelp")}</small>
          </label>
          <label class="ui-form-field" for="formatLocale">
            <span>${messages.t("region")}</span>
            <input id="formatLocale" class="ui-input" dir="ltr" spellcheck="false" autocapitalize="off" .value=${live(this.draft.formatLocale)}
              aria-describedby=${this.helpIds("formatLocale", "region-help")} aria-invalid=${this.validation?.field === "formatLocale" ? "true" : nothing}
              ?disabled=${this.applying} @input=${(event: Event) => { this.edit("formatLocale", event); }}>
            <small id="region-help">${messages.t("regionHelp")}</small>
          </label>
          <label class="ui-form-field" for="timeZone">
            <span>${messages.t("zone")}</span>
            <input id="timeZone" class="ui-input" dir="ltr" spellcheck="false" autocapitalize="off" .value=${live(this.draft.timeZone)}
              aria-describedby=${this.helpIds("timeZone", "zone-help")} aria-invalid=${this.validation?.field === "timeZone" ? "true" : nothing}
              ?disabled=${this.applying} @input=${(event: Event) => { this.edit("timeZone", event); }}>
            <small id="zone-help">${messages.t("zoneHelp")}</small>
          </label>
          <label class="ui-form-field" for="hourCycle">
            <span>${messages.t("hours")}</span>
            <select id="hourCycle" class="ui-input" aria-describedby=${this.validation?.field === "hourCycle" ? "localization-validation" : nothing} aria-invalid=${this.validation?.field === "hourCycle" ? "true" : nothing} ?disabled=${this.applying} @change=${(event: Event) => { this.edit("hourCycle", event); }}>
              <option value="" ?selected=${this.draft.hourCycle === ""}>${messages.t("hoursDefault")}</option>
              ${(["h11", "h12", "h23", "h24"] as const).map((cycle) => html`<option value=${cycle} ?selected=${this.draft.hourCycle === cycle}>${messages.t(cycle)}</option>`)}
            </select>
          </label>
          ${this.validation ? html`<p class="ui-form-error" id="localization-validation" role="alert">${messages.t(this.validation.key)}</p>` : nothing}
          ${this.failure !== undefined ? html`<p class="ui-form-error" role="alert">${messages.t("applyFailure", { diagnostic: this.failure })}</p>` : nothing}
          <div class="ui-settings-summary" aria-label=${messages.t("preview")}>
            <strong>${messages.t("preview")}</strong>
            <span>${messages.t("datePreview", { value: localization.date(this.previewDate, { dateStyle: "medium", timeStyle: "short" }) })}</span>
            <span>${messages.t("numberPreview", { value: localization.number(12345.67) })}</span>
          </div>
          <footer class="ui-settings-actions">
            <button type="submit" class="ui-button ui-button--action ui-button--primary" ?disabled=${this.applying}>${messages.t(this.applying ? "applying" : "apply")}</button>
            <button type="button" class="ui-button ui-button--action" ?disabled=${this.applying}
              @click=${() => { void this.apply(draftFromPreferences(browserLocalizationPreferences())); }}>${messages.t("reset")}</button>
          </footer>
          <p role="status">${this.saved ? messages.t("saved") : nothing}</p>
        </form>
      </section>
    `;
  }

  private helpIds(field: Field, help: string): string {
    return this.validation?.field === field ? `${help} localization-validation` : help;
  }

  private edit(field: Field, event: Event): void {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return;
    this.draft = { ...this.draft, [field]: event.target.value };
    if (this.validation?.field === field) this.validation = undefined;
    this.saved = false;
    this.failure = undefined;
  }

  private async apply(draft: Draft): Promise<void> {
    if (this.applying) return;
    this.validation = validateDraft(draft);
    this.failure = undefined;
    this.saved = false;
    if (this.validation) {
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLElement>(`#${this.validation.field}`)?.focus();
      return;
    }
    this.applying = true;
    try {
      const preferences = normalizePreferences({ language: draft.language.trim(), formatLocale: draft.formatLocale.trim(),
        ...(draft.timeZone.trim() ? { timeZone: draft.timeZone.trim() } : {}), ...(draft.hourCycle ? { hourCycle: draft.hourCycle } : {}) });
      await localization.setPreferences(preferences);
      this.baseline = draftFromPreferences(preferences);
      this.draft = { ...this.baseline };
      this.saved = true;
    } catch (cause) {
      this.failure = cause instanceof Error ? cause.message : String(cause);
    } finally { this.applying = false; }
  }

  static override styles = [uiButtonStyles, uiFormStyles, uiSettingsStyles, css`
    :host { display: block; min-width: 0; }
    p { margin: 0; }
    p, small { color: var(--pi-muted); line-height: 1.45; }
    .ui-settings-summary span { overflow-wrap: anywhere; }
    .ui-form-error { color: var(--pi-error); }
  `];
}
