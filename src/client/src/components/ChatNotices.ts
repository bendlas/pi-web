import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { SessionStatus, SessionWarningSeverity } from "../api";
import {
  notificationAnnouncementLabel,
  notificationDismissLabel,
  notificationFocusTargetAfterDismiss,
  notificationInboxOverflowLabel,
  notificationInboxTotalCount,
  notificationMessageTruncationLabel,
  notificationSeverityLabel,
  notificationTargetKey,
  notificationTrayHeading,
  notificationTrayIsCollapsed,
  setNotificationTrayCollapsed,
  type NotificationFocusTarget,
  type SelectedSessionNotificationView,
  type SessionNotificationTarget,
} from "../sessionNotifications";
import { renderSessionWarningIcon } from "./shared";

const notificationTimestampFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

function renderNotificationDisclosureIcon(collapsed: boolean) {
  return html`
    <svg class=${`notification-icon notification-disclosure-icon${collapsed ? "" : " expanded"}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  `;
}

function renderNotificationCloseIcon() {
  return html`
    <svg class="notification-icon notification-close-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12"></path>
      <path d="M18 6 6 18"></path>
    </svg>
  `;
}

function isSessionNotificationTarget(value: unknown): value is SessionNotificationTarget {
  return typeof value === "object"
    && value !== null
    && typeof Reflect.get(value, "machineId") === "string"
    && typeof Reflect.get(value, "cwd") === "string"
    && typeof Reflect.get(value, "sessionId") === "string";
}

interface PendingNotificationFocus {
  chatKey: string;
  focusTarget: NotificationFocusTarget;
}

/** A rendered session-warning row derived from live status warnings. */
export interface ChatSessionWarningRow {
  severity: SessionWarningSeverity;
  severityClass: string;
  message: string;
  source?: string;
  path?: string;
  dismissId?: string;
}

/** Derive one severity-tagged warning row per live status warning, in order. */
export function chatSessionWarningRows(status: SessionStatus | undefined): ChatSessionWarningRow[] {
  return (status?.warnings ?? []).map((warning) => ({
    severity: warning.severity,
    severityClass: `session-warning ${warning.severity}`,
    message: warning.message,
    ...(warning.source === undefined ? {} : { source: warning.source }),
    ...(warning.path === undefined ? {} : { path: warning.path }),
    ...(warning.dismiss === undefined ? {} : { dismissId: warning.dismiss.id }),
  }));
}

/** Session warnings and the notification inbox, rendered as one top-bar unit. */
@customElement("chat-notices")
export class ChatNotices extends LitElement {
  @property({ attribute: false }) notificationInbox?: SelectedSessionNotificationView;
  @property({ attribute: false }) sessionId = "";
  @property({ attribute: false }) status?: SessionStatus;
  @property({ type: Boolean }) warningsVisible = true;
  @property({ attribute: false }) onDismissWarning?: (dismissId: string) => void;
  @property({ attribute: false }) onDismissNotification?: (notificationId: string) => void;
  @property({ attribute: false }) onDismissAllNotifications?: () => void;
  @property({ attribute: false }) onToggleWarnings?: () => void;
  @state() private collapsedNotificationTargetKeys: ReadonlySet<string> = new Set();
  @state() private retainedEmptyNotificationTrayTargetKey: string | undefined;
  private pendingNotificationFocus: PendingNotificationFocus | undefined;

  private readonly handleToggleWarnings = (): void => {
    this.onToggleWarnings?.();
  };

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("notificationInbox") && this.notificationTargetChanged(changed.get("notificationInbox"))) {
      this.pendingNotificationFocus = undefined;
      this.retainedEmptyNotificationTrayTargetKey = undefined;
    }
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("notificationInbox") && this.pendingNotificationFocus !== undefined) this.focusPendingNotificationTarget();
  }

  private notificationTargetChanged(previous: unknown): boolean {
    const currentInbox = this.notificationInbox;
    if (!isSessionNotificationTarget(previous) || currentInbox === undefined) return previous !== currentInbox;
    return notificationTargetKey(previous) !== notificationTargetKey(currentInbox);
  }

  override render() {
    const warnings = this.renderWarnings();
    const notifications = this.renderNotificationTray();
    return html`
      ${warnings === null && notifications === null ? null : html`<div class="top-notices">${warnings}${notifications}</div>`}
      ${this.renderNotificationLiveRegions()}
    `;
  }

  private renderNotificationTray() {
    const inbox = this.notificationInbox;
    if (inbox?.sessionId !== this.sessionId) return null;
    const chatKey = notificationTargetKey(inbox);
    const hasPendingOverlay = inbox.pendingDismissedIds.size > 0 || inbox.dismissAllPending;
    const retainsFocusTarget = this.retainedEmptyNotificationTrayTargetKey === chatKey;
    const totalCount = notificationInboxTotalCount(inbox);
    if (totalCount === 0 && !hasPendingOverlay && !retainsFocusTarget) return null;
    const collapsed = notificationTrayIsCollapsed(this.collapsedNotificationTargetKeys, inbox);
    const toggleLabel = collapsed ? "Expand notifications" : "Collapse notifications";
    return html`
      <section class=${`notification-tray${collapsed ? " collapsed" : ""}`} role="region" aria-labelledby="session-notifications-heading" @focusout=${(event: FocusEvent) => { this.releaseEmptyNotificationTray(event); }}>
        <header class="notification-header" data-notification-focus="header" tabindex="-1">
          <strong class="notification-heading" id="session-notifications-heading">${notificationTrayHeading(inbox)}</strong>
          <div class="notification-header-actions">
            <button
              type="button"
              class="notification-control notification-clear"
              aria-label="Clear all notifications"
              title="Clear all notifications"
              ?disabled=${inbox.dismissAllPending || totalCount === 0 || this.onDismissAllNotifications === undefined}
              @click=${() => { this.dismissAllNotifications(); }}
            >Clear</button>
            <button
              type="button"
              class="notification-control notification-toggle"
              aria-label=${toggleLabel}
              title=${toggleLabel}
              aria-expanded=${String(!collapsed)}
              aria-controls="session-notification-list"
              @click=${() => { this.toggleNotificationTray(inbox, collapsed); }}
            >${renderNotificationDisclosureIcon(collapsed)}</button>
          </div>
        </header>
        <div class="notification-list" id="session-notification-list" ?hidden=${collapsed}>
          ${inbox.discardedCount === 0 ? null : html`
            <p class="notification-overflow">${notificationInboxOverflowLabel(inbox.discardedCount)}</p>
          `}
          ${inbox.notifications.map((notification) => {
            const label = notificationSeverityLabel(notification.severity);
            const truncationLabel = notificationMessageTruncationLabel(notification);
            return html`
              <article class=${`notification-row ${notification.severity}`} data-notification-id=${notification.id} tabindex="-1">
                <div class="notification-metadata">
                  <strong class="notification-severity">${label}</strong>
                  <span aria-hidden="true">·</span>
                  <time datetime=${notification.receivedAt}>${notificationTimestampFormatter.format(new Date(notification.receivedAt))}</time>
                </div>
                <p class="notification-message" dir="auto">${notification.message}</p>
                ${truncationLabel === undefined ? null : html`<p class="notification-truncated">${truncationLabel}</p>`}
                <button
                  type="button"
                  class="notification-row-dismiss"
                  aria-label=${notificationDismissLabel(notification)}
                  title="Dismiss notification"
                  ?disabled=${inbox.pendingDismissedIds.has(notification.id) || inbox.dismissAllPending || this.onDismissNotification === undefined}
                  @click=${() => { this.dismissNotification(notification.id); }}
                >${renderNotificationCloseIcon()}</button>
              </article>
            `;
          })}
        </div>
      </section>
    `;
  }

  private renderNotificationLiveRegions() {
    const announcements = this.notificationInbox?.sessionId === this.sessionId ? this.notificationInbox.announcements : [];
    const polite = announcements.filter((announcement) => announcement.severity !== "error");
    const assertive = announcements.filter((announcement) => announcement.severity === "error");
    return html`
      <div class="visually-hidden notification-live" aria-live="polite" aria-atomic="false">${repeat(polite, (announcement) => announcement.id, (announcement) => html`<span data-announcement-id=${announcement.id}>${notificationAnnouncementLabel(announcement)}</span>`)}</div>
      <div class="visually-hidden notification-live" aria-live="assertive" aria-atomic="false">${repeat(assertive, (announcement) => announcement.id, (announcement) => html`<span data-announcement-id=${announcement.id}>${notificationAnnouncementLabel(announcement)}</span>`)}</div>
    `;
  }

  private toggleNotificationTray(inbox: SelectedSessionNotificationView, collapsed: boolean): void {
    this.collapsedNotificationTargetKeys = setNotificationTrayCollapsed(this.collapsedNotificationTargetKeys, inbox, !collapsed);
  }

  private dismissNotification(notificationId: string): void {
    const inbox = this.notificationInbox;
    if (inbox === undefined || this.onDismissNotification === undefined) return;
    const focusTarget = notificationFocusTargetAfterDismiss(inbox.notifications, notificationId);
    const chatKey = notificationTargetKey(inbox);
    this.pendingNotificationFocus = { chatKey, focusTarget };
    if (focusTarget.kind === "header") this.retainedEmptyNotificationTrayTargetKey = chatKey;
    this.onDismissNotification(notificationId);
  }

  private dismissAllNotifications(): void {
    const inbox = this.notificationInbox;
    if (inbox === undefined || this.onDismissAllNotifications === undefined) return;
    const chatKey = notificationTargetKey(inbox);
    this.pendingNotificationFocus = { chatKey, focusTarget: { kind: "header" } };
    this.retainedEmptyNotificationTrayTargetKey = chatKey;
    this.onDismissAllNotifications();
  }

  private releaseEmptyNotificationTray(event: FocusEvent): void {
    const tray = event.currentTarget;
    const next = event.relatedTarget;
    if (tray instanceof HTMLElement && next instanceof Node && tray.contains(next)) return;
    // Removing the activated row can emit focusout before updated() moves focus.
    if (this.pendingNotificationFocus !== undefined) return;
    const inbox = this.notificationInbox;
    if (inbox !== undefined
      && this.retainedEmptyNotificationTrayTargetKey === notificationTargetKey(inbox)
      && notificationInboxTotalCount(inbox) === 0) this.retainedEmptyNotificationTrayTargetKey = undefined;
  }

  private focusPendingNotificationTarget(): void {
    const pending = this.pendingNotificationFocus;
    this.pendingNotificationFocus = undefined;
    const inbox = this.notificationInbox;
    if (pending === undefined || inbox === undefined || notificationTargetKey(inbox) !== pending.chatKey) return;
    const target = pending.focusTarget;
    if (target.kind === "header") {
      this.renderRoot.querySelector<HTMLElement>("[data-notification-focus='header']")?.focus();
      return;
    }
    const row = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-notification-id]"))
      .find((candidate) => candidate.dataset["notificationId"] === target.notificationId);
    if (row !== undefined) {
      row.focus();
      return;
    }
    if (notificationInboxTotalCount(inbox) === 0) this.retainedEmptyNotificationTrayTargetKey = pending.chatKey;
    this.renderRoot.querySelector<HTMLElement>("[data-notification-focus='header']")?.focus();
  }

  private renderWarnings() {
    const rows = chatSessionWarningRows(this.status);
    if (!this.warningsVisible || rows.length === 0) return null;
    return html`
      <aside class="session-warnings" role="alert" aria-live="polite">
        ${this.onToggleWarnings === undefined ? null : html`
          <div class="session-warnings-controls">
            <button
              type="button"
              class="session-warnings-collapse"
              title="Minimise warnings"
              aria-label="Minimise warnings"
              @click=${this.handleToggleWarnings}
            >
              <svg class="session-warnings-collapse-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m18 15-6-6-6 6"></path>
              </svg>
              <span>Minimise</span>
            </button>
          </div>
        `}
        ${rows.map((row) => {
          const dismissId = row.dismissId;
          return html`
          <div class=${row.severityClass}>
            <div class="session-warning-head">
              ${renderSessionWarningIcon(row.severity, "session-warning-icon")}
              ${row.source === undefined ? null : html`<span class="session-warning-source">${row.source}</span>`}
            </div>
            <div class="session-warning-body">
              <p class="session-warning-message">${row.message}</p>
              ${row.path === undefined ? null : html`<p class="session-warning-path">${row.path}</p>`}
            </div>
            ${dismissId === undefined ? null : html`
              <button
                type="button"
                class="session-warning-dismiss"
                title="Don't show this warning again"
                aria-label="Dismiss warning"
                @click=${() => { this.onDismissWarning?.(dismissId); }}
              >×</button>
            `}
          </div>
        `;
        })}
      </aside>
    `;
  }

  static override styles = css`
    :host { display: block; min-width: 0; }
    .top-notices { box-sizing: border-box; max-height: 40vh; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg-overlay); }
    .session-warnings { flex: 0 1 auto; display: grid; gap: 8px; max-height: 50%; min-height: 0; overflow-y: auto; box-sizing: border-box; padding: 10px 16px; border-bottom: 1px solid var(--pi-border-muted); }
    .session-warnings:only-child { flex: 1 1 auto; max-height: 100%; border-bottom: 0; }
    .session-warnings-controls { display: flex; justify-content: flex-end; }
    .session-warnings-collapse { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); padding: 4px 7px; font: 12px system-ui, sans-serif; cursor: pointer; }
    .session-warnings-collapse:hover, .session-warnings-collapse:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); background: var(--pi-bg-overlay); }
    .session-warnings-collapse:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
    .session-warnings-collapse-icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    .session-warning { position: relative; display: grid; gap: 4px; box-sizing: border-box; padding: 10px 34px 10px 12px; border: 1px solid var(--pi-warning-border); border-radius: 10px; background: var(--pi-warning-surface); color: var(--pi-text); }
    .session-warning.error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 12%, var(--pi-surface)); }
    .session-warning.info { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
    .session-warning-head { display: flex; align-items: center; gap: 8px; min-height: 16px; }
    .session-warning-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .session-warning-body { min-width: 0; display: grid; gap: 3px; }
    .session-warning-message { margin: 0; overflow-wrap: anywhere; }
    .session-warning-path { margin: 0; color: var(--pi-muted); font-size: 12px; font-family: var(--pi-mono, ui-monospace, monospace); overflow-wrap: anywhere; }
    .session-warning-source { color: var(--pi-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .session-warning-dismiss { position: absolute; top: 6px; right: 6px; display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-muted); font: 15px/1 system-ui, sans-serif; cursor: pointer; }
    .session-warning-dismiss:hover, .session-warning-dismiss:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); background: var(--pi-bg-overlay); }
    .session-warning-dismiss:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
    .notification-tray { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--pi-bg-overlay); }
    .notification-tray.collapsed { flex: 0 0 auto; }
    .notification-header { position: sticky; top: 0; z-index: 2; flex: 0 0 auto; min-width: 0; display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 8px; box-sizing: border-box; min-height: 40px; padding: 4px 10px; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg-overlay); }
    .notification-tray.collapsed .notification-header { border-bottom: 0; }
    .notification-header:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -3px; }
    .notification-heading { min-width: 0; flex: 1 1 auto; overflow: hidden; color: var(--pi-text-bright); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .notification-header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
    .notification-control, .notification-row-dismiss { box-sizing: border-box; min-height: 32px; border: 0; border-radius: 6px; background: transparent; color: var(--pi-muted); cursor: pointer; }
    .notification-control { padding: 0 7px; font: 12px system-ui, sans-serif; white-space: nowrap; }
    .notification-toggle { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; }
    .notification-control:hover, .notification-control:focus-visible, .notification-row-dismiss:hover, .notification-row-dismiss:focus-visible { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
    .notification-control:focus-visible, .notification-row-dismiss:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    .notification-control:disabled, .notification-row-dismiss:disabled { opacity: .5; background: transparent; cursor: default; }
    .notification-icon { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    .notification-disclosure-icon.expanded { transform: rotate(90deg); }
    .notification-close-icon { width: 16px; height: 16px; }
    .notification-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; box-sizing: border-box; padding: 0 10px 5px; }
    .notification-list[hidden] { display: none; }
    .notification-overflow { margin: 0; padding: 7px 2px; border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
    .notification-row { position: relative; min-width: 0; display: grid; gap: 4px; box-sizing: border-box; padding: 9px 38px 9px 2px; border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-text); }
    .notification-row:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .notification-metadata { min-width: 0; display: flex; align-items: baseline; gap: 5px; color: var(--pi-muted); font-size: 11px; }
    .notification-severity { color: var(--pi-muted); font-size: inherit; font-weight: 600; }
    .notification-row.warning .notification-severity { color: var(--pi-warning); }
    .notification-row.error .notification-severity { color: var(--pi-danger); }
    .notification-message { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; text-align: start; unicode-bidi: plaintext; }
    .notification-truncated { margin: 0; color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
    .notification-row-dismiss { position: absolute; top: 5px; right: 0; display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; }
    .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important; }
    .notification-live span { display: block; }
    @media (pointer: coarse) {
      .notification-control, .notification-row-dismiss { min-height: 34px; }
      .notification-toggle, .notification-row-dismiss { width: 34px; height: 34px; }
      .notification-row { padding-right: 40px; }
    }
    @media (max-width: 520px) {
      .notification-header { gap: 4px; padding-inline: 8px; }
      .notification-list { padding-inline: 8px; }
    }
  `;
}
