import type { PluginActivationContext, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import type { LogEntry } from "./protocol.js";
import { renderCaptainMarkdown } from "./markdown.js";
import { captainText, captainValue, type CaptainContent, type CaptainStaticKey } from "./localization.js";

type Html = PluginActivationContext["html"];
export interface SourceSession { id: string; name: string }
export function selectedSourceSession(context: WorkspacePanelContext, content?: CaptainContent): SourceSession | undefined {
  if (context.state?.selectedMachine && context.state.selectedMachine.id !== context.machine.id) return;
  const selected = context.state?.selectedSession;
  if (!selected || selected.archived || selected.pending || selected.cwd !== context.workspace.path) return;
  return { id: selected.id, name: selected.name !== undefined && selected.name.trim() !== "" ? selected.name : captainText(content, "sessionName", { id: captainValue(content, selected.id.slice(0, 8)) }) };
}
export interface CaptainPanelView {
  content?: CaptainContent;
  entries: LogEntry[]; selected?: LogEntry; status: string;
  connected: boolean; connecting: boolean; pending: boolean;
  source?: SourceSession;
  notice?: string;
  machineName: string;
  onTranslate: () => void;
  onReconnect: () => void;
  onRead(id: string): void;
  onOpenSource(id: string): void;
}
function dateLabel(value: string, content?: CaptainContent): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : content?.localization.date(date, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) ?? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
export function renderCaptainPanel(html: Html, view: CaptainPanelView) {
  const content = view.content;
  const t = (key: CaptainStaticKey) => captainText(content, key);
  const working = view.entries.some((entry) => entry.status === "running");
  const pirateSelected = view.source !== undefined && view.entries.some((entry) => entry.sessionId === view.source?.id);
  const disabled = !view.connected || view.connecting || view.pending || working || !view.source || pirateSelected;
  const selected = view.selected;
  const sourceSessionId = selected?.sourceSessionId;
  const status = view.connecting ? t("connecting") : !view.connected ? t("lost") : view.pending ? t("fetching")
    : working ? t("translating") : !view.source ? t("selectSession") : pirateSelected ? t("selectDifferent")
      : t("ready");
  return html`<style>${styles}</style>
    <section class="captains-log" aria-label=${t("title")} dir=${content?.localization.direction ?? "ltr"}>
      <div class="captain-heading"><h2>⚓ ${t("title")}</h2><p class="muted">${t("subtitle")}</p></div>
      <div class="captain-source"><span class="muted">${t("selectedSession")}</span><strong dir="auto">${view.source?.name ?? t("noSession")}</strong></div>
      <button class="ui-button ui-button--primary captain-primary" ?disabled=${disabled} @click=${view.onTranslate}>${t("translate")}</button>
      <p class="captain-status" role="status" aria-live="polite">${status}
        ${!view.connected && !view.connecting ? html`<button class="ui-button ui-button--compact" @click=${view.onReconnect}>${t("reconnect")}</button>` : null}
      </p>
      ${!view.connected && !view.connecting ? html`<p class="captain-notice">${t("reconnectNotice")}</p>` : null}
      ${view.notice !== undefined && view.notice !== "" ? html`<p class="captain-notice" role="alert" dir="auto">${view.notice}</p>` : null}
      ${selected ? html`<article class="captain-reply" aria-label=${t("replyLabel")}>
        <div class="captain-reply-heading"><strong>${selected.status === "running" ? t("working") : selected.id === view.entries[0]?.id ? t("last") : t("earlier")}</strong><time datetime=${selected.createdAt} dir="auto">${dateLabel(selected.createdAt, content)}</time></div>
        ${selected.status === "completed" ? html`<div class="captain-answer" dir="auto">${selected.text ? renderCaptainMarkdown(html, selected.text, content) : t("receiving")}</div>`
          : selected.status === "running" ? html`<p class="muted">${t("reading")}</p>`
            : html`<div class="captain-notice" role="alert"><strong>${selected.status === "interrupted" ? t("interrupted") : t("failed")}</strong><p dir="auto">${selected.text || t("failureHelp")}</p></div>`}
        ${sourceSessionId !== undefined && sourceSessionId !== "" ? html`<button class="ui-button" @click=${() => { view.onOpenSource(sourceSessionId); }}>${t("openSource")}</button>` : null}
      </article>` : html`<p class="captain-empty muted">${t("empty")}</p>`}
      <div class="captain-secondary">
        ${view.entries.length > 1 ? html`<details><summary>${captainText(content, "history", { count: content?.localization.number(view.entries.length) ?? new Intl.NumberFormat("en").format(view.entries.length) })}</summary>
          <div class="captain-history">${view.entries.map((entry) => html`<button class=${`ui-button${entry.id === selected?.id ? " selected" : ""}`} aria-pressed=${entry.id === selected?.id ? "true" : "false"} ?disabled=${!view.connected} @click=${() => { view.onRead(entry.id); }}>
            <span>${captainText(content, "historyEntry", { date: captainValue(content, dateLabel(entry.createdAt, content)), status: entry.status === "completed" ? t("translated") : entry.status === "running" ? t("historyWorking") : t("notCompleted") })}</span>
          </button>`)}</div>
        </details>` : null}
        <details class="captain-diagnostics"><summary>${t("diagnostics")}</summary>
          <p>${view.status}</p>
          ${selected ? html`<dl><dt>${t("machine")}</dt><dd dir="auto">${view.machineName}</dd><dt>${t("sourceSession")}</dt><dd dir="auto">${selected.sourceSessionId ?? t("unknown")}</dd><dt>${t("pirateSession")}</dt><dd dir="auto">${selected.sessionId || t("notCreated")}</dd><dt>${t("request")}</dt><dd dir="ltr">${selected.id}</dd></dl>
            <p dir="auto">${selected.question}</p><ol>${selected.stages.map((stage) => html`<li dir="auto">${stage}</li>`)}</ol>` : null}
        </details>
        <p class="captain-footnote muted">${t("footnote")}</p>
      </div>
    </section>`;
}
// Content layout stays package-scoped; native buttons use the host UI styles capability.
const styles = `
  captains-log-lifetime { display: block; min-inline-size: 0; }
  .captains-log { box-sizing: border-box; padding: 16px; min-inline-size: 0; color: inherit; font: inherit; line-height: 1.5; overflow-wrap: anywhere; }
  .captains-log *, .captains-log *::before, .captains-log *::after { box-sizing: border-box; }
  .captains-log h2, .captains-log p { margin: 0; }
  .captains-log h2 { font-size: 15px; }
  .captains-log summary:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
  .captains-log .captain-source { display: grid; gap: 3px; margin: 18px 0 12px; padding: 10px 12px; background: var(--pi-surface); border: 1px solid var(--pi-border-muted); border-radius: 8px; overflow-wrap: anywhere; }
  .captains-log .captain-source span { font-size: 11px; }
  .captains-log .captain-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 10px 0 16px; color: var(--pi-muted); font-size: 12px; }
  .captains-log .captain-notice { padding: 12px; margin-block-end: 12px; border: 1px solid var(--pi-warning-border); border-radius: 8px; background: var(--pi-warning-surface); overflow-wrap: anywhere; white-space: pre-wrap; }
  .captains-log .captain-notice p { margin-block-start: 6px; }
  .captains-log .captain-empty { padding: 16px 0; }
  .captains-log .captain-reply { padding: 16px 0; border-block-start: 1px solid var(--pi-border-muted); }
  .captains-log .captain-reply-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-block-end: 10px; }
  .captains-log time { color: var(--pi-muted); font-size: 11px; }
  .captains-log .captain-answer { line-height: 1.65; overflow-wrap: anywhere; min-inline-size: 0; }
  .captains-log .captain-answer > :first-child { margin-block-start: 0; }
  .captains-log .captain-answer > :last-child { margin-block-end: 0; }
  .captains-log .captain-answer p, .captains-log .captain-answer ul, .captains-log .captain-answer ol { margin: .65em 0; }
  .captains-log .captain-answer h1, .captains-log .captain-answer h2, .captains-log .captain-answer h3,
  .captains-log .captain-answer h4, .captains-log .captain-answer h5, .captains-log .captain-answer h6 { margin: 1em 0 .4em; line-height: 1.3; }
  .captains-log .captain-answer h1 { font-size: 1.5em; }
  .captains-log .captain-answer h2 { font-size: 1.3em; }
  .captains-log .captain-answer h3 { font-size: 1.15em; }
  .captains-log .captain-answer ul, .captains-log .captain-answer ol { padding-inline-start: 1.7em; }
  .captains-log .captain-answer blockquote { margin: .75em 0; padding-inline-start: 1em; border-inline-start: 3px solid var(--pi-border-muted); color: var(--pi-muted); }
  .captains-log [dir="auto"] { unicode-bidi: isolate; }
  .captains-log .captain-answer code { direction: ltr; unicode-bidi: isolate; font-family: monospace; background: var(--pi-surface); border-radius: 3px; padding: .1em .25em; }
  .captains-log .captain-answer pre { max-inline-size: 100%; overflow: auto; padding: 12px; background: var(--pi-surface); border: 1px solid var(--pi-border-muted); border-radius: 6px; white-space: pre; overflow-wrap: normal; direction: ltr; unicode-bidi: isolate; text-align: start; }
  .captains-log .captain-answer pre code { padding: 0; background: none; }
  .captains-log .captain-answer a { color: var(--pi-accent); text-decoration: underline; }
  .captains-log .captain-answer a:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
  .captains-log .captain-table-scroll { max-inline-size: 100%; overflow: auto; margin: .75em 0; }
  .captains-log .captain-answer table { border-collapse: collapse; width: 100%; }
  .captains-log .captain-answer th, .captains-log .captain-answer td { border: 1px solid var(--pi-border-muted); padding: 6px 10px; text-align: start; }
  .captains-log .captain-answer th { background: var(--pi-surface); }
  .captains-log .captain-answer hr { border: 0; border-block-start: 1px solid var(--pi-border-muted); }
  .captains-log .captain-secondary { border-block-start: 1px solid var(--pi-border-muted); margin-block-start: 12px; padding-block-start: 6px; }
  .captains-log details { padding: 8px 0; }
  .captains-log summary { cursor: pointer; color: var(--pi-muted); }
  .captains-log details p { margin: 8px 0; overflow-wrap: anywhere; }
  .captains-log .captain-history { display: grid; gap: 6px; padding-block-start: 8px; }
  .captains-log .captain-history button { justify-content: flex-start; text-align: start; min-inline-size: 0; }
  .captains-log dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; font-size: 11px; }
  .captains-log dd { margin: 0; overflow-wrap: anywhere; }
  .captains-log .captain-footnote { font-size: 11px; margin-block-start: 10px; }
`;
