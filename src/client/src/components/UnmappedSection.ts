import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionInfo, UnmappedSessionGroup } from "../api";
import { shortSessionId } from "../sessionLabels";

/**
 * A nested "Unmapped" subsection for the Projects and Workspaces lists. It
 * mirrors the Archived subsection in SessionList: a collapsible heading over
 * cwd groups, each expanding to read-only session rows. Every session it renders
 * was marked `readOnly` by the server's unmapped-history index.
 */
@customElement("unmapped-section")
export class UnmappedSection extends LitElement {
  @property({ attribute: false }) groups: UnmappedSessionGroup[] = [];
  @property({ attribute: false }) selectedSessionId?: string;
  /** Rendered label for the heading, e.g. "Unmapped Projects". */
  @property({ type: String }) sectionTitle = "Unmapped";
  @property({ attribute: false }) onSelectSession?: (session: SessionInfo) => void | Promise<void>;
  @state() private expanded = false;
  @state() private expandedCwds = new Set<string>();

  override render() {
    if (this.groups.length === 0) return null;
    const sessionCount = this.groups.reduce((total, group) => total + group.sessions.length, 0);
    return html`
      <div class="unmapped">
        <h3 class="heading">
          <button class="section-toggle" aria-expanded=${String(this.expanded)} @click=${() => { this.expanded = !this.expanded; }}>
            <span>${this.expanded ? "▾" : "▸"} ${this.sectionTitle}</span>
          </button>
          <small class="section-count">${this.groups.length} · ${sessionCount}</small>
        </h3>
        ${this.expanded ? html`
          <div class="groups">
            ${this.groups.map((group) => this.renderGroup(group))}
          </div>
        ` : null}
      </div>
    `;
  }

  private renderGroup(group: UnmappedSessionGroup) {
    const open = this.expandedCwds.has(group.cwd);
    // The visible label drops the project/worktree prefix; the full path stays
    // as the row title (and the expansion key) so identical suffixes stay apart.
    const fullPath = group.cwd === "" ? "(no recorded location)" : group.cwd;
    const label = group.relativePath ?? fullPath;
    return html`
      <div class="group">
        <button class="group-row" aria-expanded=${String(open)} title=${fullPath} @click=${() => { this.toggleGroup(group.cwd); }}>
          <span class="group-cwd" dir="auto">${label}</span>
          <span class="badges">
            <span class="badge ${group.exists ? "live" : "deleted"}">${group.exists ? "unmapped" : "deleted"}</span>
            <span class="badge">${group.sessions.length}</span>
          </span>
        </button>
        ${open ? html`<div class="sessions">${group.sessions.map((session) => this.renderSession(session))}</div>` : null}
      </div>
    `;
  }

  private renderSession(session: SessionInfo) {
    const label = session.firstMessage !== "" ? session.firstMessage : shortSessionId(session.id);
    return html`
      <div
        class="action-row session-row ${this.selectedSessionId === session.id ? "selected" : ""}"
        tabindex="0"
        title=${label}
        @click=${() => { void this.onSelectSession?.(session); }}
        @keydown=${(event: KeyboardEvent) => { this.handleSessionKeydown(event, session); }}
      >
        <div class="action-main">
          <span class="action-name" dir="auto">${label}</span>
          <small>read-only · ${String(session.messageCount)} messages</small>
        </div>
      </div>
    `;
  }

  private handleSessionKeydown(event: KeyboardEvent, session: SessionInfo): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void this.onSelectSession?.(session);
  }

  private toggleGroup(cwd: string): void {
    const next = new Set(this.expandedCwds);
    if (next.has(cwd)) next.delete(cwd);
    else next.add(cwd);
    this.expandedCwds = next;
  }

  static override styles = css`
    :host { display: block; }
    .heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 14px 0 6px; color: var(--pi-muted); font-size: 12px; text-transform: uppercase; }
    .section-toggle { flex: 1 1 auto; min-width: 0; border: 0; background: transparent; color: inherit; padding: 0; font: inherit; text-align: left; text-transform: inherit; cursor: pointer; }
    .section-toggle span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .section-count { flex: 0 0 auto; color: var(--pi-muted); }
    .groups { display: grid; gap: 2px; }
    .group-row { box-sizing: border-box; display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; border: 1px solid var(--pi-border-muted); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 6px 9px; font: inherit; text-align: left; cursor: pointer; }
    .group-row:hover { background: var(--pi-surface-hover); }
    .group-cwd { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badges { flex: 0 0 auto; display: flex; gap: 4px; }
    .badge { display: inline-block; border: 1px solid var(--pi-border); border-radius: 999px; color: var(--pi-muted); padding: 0 5px; font-size: 11px; }
    .badge.deleted { color: var(--pi-danger); border-color: color-mix(in srgb, var(--pi-danger) 45%, transparent); }
    .sessions { display: grid; gap: 2px; margin: 4px 0 6px 12px; }
    .action-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); cursor: pointer; }
    .action-row:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; border-radius: 8px; }
    .action-row.selected .action-main { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .action-name { display: -webkit-box; max-height: 2.5em; overflow: hidden; overflow-wrap: anywhere; line-height: 1.25; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .action-main { box-sizing: border-box; min-width: 0; width: 100%; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-muted); padding: 7px 9px; text-align: left; }
    .action-row:not(.selected):hover .action-main { background: var(--pi-surface-hover); }
    .action-main small { display: block; margin-top: 2px; color: var(--pi-muted); }
  `;
}
