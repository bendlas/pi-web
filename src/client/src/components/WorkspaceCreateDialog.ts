import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./ModalSurface";

export interface WorkspaceCreateDraft {
  name: string;
  baseRef: string;
  branchName: string;
}

@customElement("workspace-create-dialog")
export class WorkspaceCreateDialog extends LitElement {
  /** Branch the new worktree branches from by default (the current branch). */
  @property({ attribute: false }) defaultBaseRef = "";
  /** True while the creation request is in flight. */
  @property({ type: Boolean }) loading = false;
  /** Non-fatal error message to surface. */
  @property({ type: String }) error = "";
  @property({ attribute: false }) onSubmit?: (draft: WorkspaceCreateDraft) => void | Promise<void>;
  @property({ attribute: false }) onClose?: () => void;

  @state() private name = "";
  @state() private baseRef = "";
  @state() private branchName = "";
  @state() private formError = "";

  override connectedCallback(): void {
    super.connectedCallback();
    this.baseRef = this.defaultBaseRef;
  }

  private get effectiveBranchName(): string {
    return this.branchName.trim() === "" ? this.name.trim() : this.branchName.trim();
  }

  override render(): TemplateResult {
    const canSubmit = this.name.trim() !== "" && !this.loading;
    return html`
      <modal-surface .onClose=${() => { this.onClose?.(); }} .label=${"Add workspace"}>
        <header>
          <div>
            <span class="eyebrow">Workspace</span>
            <h1>Add workspace</h1>
          </div>
          <button class="close-button" title="Close" aria-label="Close" @click=${() => { this.onClose?.(); }}>×</button>
        </header>
        <div class="body">
          <p class="intro">Create a new git worktree. It appears as a workspace you can open immediately, without starting a session.</p>
          <fieldset ?disabled=${this.loading}>
            <label class="field">
              <span class="field-label">Name<abbr title="required" aria-label="required">*</abbr></span>
              <input
                class="text-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="feature-x"
                .value=${this.name}
                @input=${(event: Event) => { this.name = inputValue(event); this.formError = ""; }}
              />
            </label>
            <label class="field">
              <span class="field-label">Base ref</span>
              <input
                class="text-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder=${this.defaultBaseRef === "" ? "HEAD" : this.defaultBaseRef}
                .value=${this.baseRef}
                @input=${(event: Event) => { this.baseRef = inputValue(event); }}
              />
              <small class="hint">Branch, commit, or tag to branch from. Defaults to the current branch${this.defaultBaseRef === "" ? "" : ` (${this.defaultBaseRef})`}.</small>
            </label>
            <label class="field">
              <span class="field-label">Branch name</span>
              <input
                class="text-input"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder=${this.name.trim() === "" ? "name" : this.name.trim()}
                .value=${this.branchName}
                @input=${(event: Event) => { this.branchName = inputValue(event); }}
              />
              <small class="hint">New branch name. Defaults to the worktree name${this.name.trim() === "" ? "" : ` (${this.name.trim()})`}.</small>
            </label>
          </fieldset>
          ${this.renderMessage()}
        </div>
        <footer>
          <button ?disabled=${this.loading} @click=${() => { this.onClose?.(); }}>Cancel</button>
          <button class="primary" ?disabled=${!canSubmit} title=${canSubmit ? "Create workspace" : "Enter a name"} @click=${() => { this.submit(); }}>${this.loading ? "Creating…" : "Create workspace"}</button>
        </footer>
      </modal-surface>
    `;
  }

  private renderMessage(): TemplateResult | null {
    const message = this.formError || this.error;
    return message === "" ? null : html`<div class="dialog-error" role="alert">${message}</div>`;
  }

  private submit(): void {
    const name = this.name.trim();
    if (name === "") {
      this.formError = "Enter a workspace name.";
      return;
    }
    void this.onSubmit?.({
      name,
      baseRef: this.baseRef.trim(),
      branchName: this.effectiveBranchName,
    });
  }

  static override styles = css`
    :host { display: block; }
    .eyebrow { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--pi-text-muted, #888); }
    h1 { margin: 2px 0 0; font-size: 20px; }
    .body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
    .intro { margin: 0; color: var(--pi-text-muted, #888); line-height: 1.4; }
    fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field-label { font-weight: 600; }
    .field-label abbr { color: var(--pi-danger, #c0392b); text-decoration: none; margin-left: 2px; }
    .text-input { padding: 8px 10px; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); font: inherit; }
    .hint { color: var(--pi-text-muted, #888); font-size: 12px; line-height: 1.35; }
    .dialog-error { color: var(--pi-danger, #c0392b); line-height: 1.35; }
    footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--pi-border); }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 8px 14px; cursor: pointer; }
    button.primary { background: var(--pi-accent, #2d7ef7); color: #fff; border-color: transparent; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .close-button { border: 0; background: transparent; font-size: 22px; line-height: 1; cursor: pointer; color: var(--pi-text-muted, #888); }
  `;
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}
