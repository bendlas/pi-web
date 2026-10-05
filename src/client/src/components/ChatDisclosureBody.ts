import { LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * Builds its content only while the enclosing disclosure is open, so a closed
 * block costs nothing to parse or lay out. The disclosure's own toggle events
 * drive the element, which keeps toggling a block from rerendering the
 * transcript that holds it.
 */
@customElement("chat-disclosure-body")
export class ChatDisclosureBody extends LitElement {
  @property({ attribute: false }) content: TemplateResult | undefined;
  private open = false;
  private readonly disclosureToggle = (): void => { this.sync(); };

  protected override createRenderRoot(): HTMLElement {
    // Keep the body in the transcript's styling scope instead of adding a shadow root.
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.sync();
    this.closest("details")?.addEventListener("toggle", this.disclosureToggle);
  }

  override disconnectedCallback(): void {
    this.closest("details")?.removeEventListener("toggle", this.disclosureToggle);
    super.disconnectedCallback();
  }

  private sync(): void {
    const open = this.closest("details")?.open ?? false;
    if (open === this.open) return;
    this.open = open;
    this.requestUpdate();
  }

  override render(): TemplateResult | typeof nothing {
    return this.open ? this.content ?? nothing : nothing;
  }
}
