import { randomUUID } from "node:crypto";
import {
  ASK_USER_ID_MAX_LENGTH,
  ASK_USER_OPTION_LIMIT,
  ASK_USER_OTHER_TEXT_MAX_LENGTH,
  ASK_USER_QUESTION_LIMIT,
  ASK_USER_TEXT_MAX_LENGTH,
  type AskUserAnswer,
  type AskUserCloseReason,
  type AskUserOutcome,
  type AskUserQuestion,
  type AskUserQuestionOption,
  type AskUserQuestionRecord,
  type AskUserSubmission,
  type PendingAskUser,
} from "../../shared/apiTypes.js";
import {
  PENDING_ASK_STATE_VERSION,
  type PendingAskPersistence,
  type PendingAskPersistedEntry,
  type PendingAskPersistedState,
} from "./pendingAskPersistence.js";

export interface PendingAskStoreOptions {
  now?: (() => Date) | undefined;
  createAskId?: (() => string) | undefined;
  /**
   * Durable backing for open-ask state. When supplied, every open/close writes
   * through to disk and {@link PendingAskStore.load} repopulates the map at
   * daemon startup, so a reload no longer drops questions the user still owes.
   * Omit for the in-memory store used by tests and single-shot callers.
   */
  persistence?: PendingAskPersistence | undefined;
  /** Reported when a load or save fails; persistence is best-effort, never fatal. */
  onPersistenceError?: ((operation: "load" | "save", error: unknown) => void) | undefined;
}

/** A question set an agent wants to post to the user of one session. */
export interface PendingAskOpenInput {
  sessionId: string;
  questions: AskUserQuestion[];
}

/**
 * A freshly opened ask, plus the outcome of the ask it replaced. A session holds
 * at most one open ask, so opening while one is still unanswered supersedes it —
 * and the caller must report that outcome to the model, naming the questions the
 * user never got to answer.
 */
export interface PendingAskOpenResult {
  ask: PendingAskUser;
  superseded?: AskUserOutcome;
}

/**
 * Result of submitting or cancelling an ask. `"stale"` means the ask named by the
 * caller is no longer the session's open ask (already submitted, superseded, or
 * gone with its daemon-side session), which is an ordinary race a browser can
 * lose — not an error.
 */
export type PendingAskCloseResult =
  | { status: "closed"; outcome: AskUserOutcome }
  | { status: "stale" };

/** Rejected input: a question set is malformed, or an answer does not fit its question. */
export class PendingAskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingAskValidationError";
  }
}

type RecordedAnswers = ReadonlyMap<string, AskUserAnswer>;

/**
 * Daemon-owned open-ask state: one unanswered question set per session.
 *
 * The store is pure domain logic — no Fastify, no Pi session, no I/O, no timers.
 * It validates asks and answers, owns the open/supersede/submit/cancel
 * transitions, and computes the answered-versus-unanswered outcome that both the
 * model-facing message and the browser record are rendered from. Callers publish
 * the returned asks and outcomes; the store never emits anything itself.
 *
 * State is daemon-owned and, when the store is given a {@link PendingAskPersistence},
 * durable across daemon reloads: the open ask is the one piece of session state
 * the browser cannot rebuild itself, because `ask_user` terminates the run and
 * the questions exist only here. Without persistence the store is in-memory and
 * daemon-lifetime. Either way the browser rehydrates the widget from
 * `SessionStatus`; persistence just keeps that status honest after a reload.
 */
export class PendingAskStore {
  private readonly now: () => Date;
  private readonly createAskId: () => string;
  private readonly persistence: PendingAskPersistence | undefined;
  private readonly onPersistenceError: (operation: "load" | "save", error: unknown) => void;
  private readonly openBySessionId = new Map<string, PendingAskUser>();
  private loadPromise: Promise<void> | undefined;
  private loaded: boolean;
  private persistenceWorker: Promise<void> = Promise.resolve();

  constructor(options: PendingAskStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createAskId = options.createAskId ?? randomUUID;
    this.persistence = options.persistence;
    this.onPersistenceError = options.onPersistenceError ?? (() => undefined);
    // An in-memory store is ready immediately; a persistent one waits for load().
    this.loaded = this.persistence === undefined;
  }

  /**
   * Populate the in-memory map from the backing store. Called once at daemon
   * startup; must complete before any session can publish status. No-op for an
   * in-memory store, and idempotent if called more than once.
   */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadPromise !== undefined) return this.loadPromise;
    this.loadPromise = this.loadPersistedState();
    return this.loadPromise;
  }

  private async loadPersistedState(): Promise<void> {
    if (this.persistence === undefined) {
      this.loaded = true;
      return;
    }
    try {
      const value = await this.persistence.load();
      if (value === undefined) return;
      // Re-validate each entry against the current schema so a stale or
      // hand-edited file drops bad asks individually rather than poisoning the
      // whole map; a skipped entry just means that one question set is lost.
      for (const entry of parsePersistedEntries(value)) {
        try {
          this.openBySessionId.set(entry.sessionId, normalizePersistedAsk(entry.ask));
        } catch (error) {
          this.reportPersistenceError("load", error);
        }
      }
    } catch (error) {
      this.reportPersistenceError("load", error);
    } finally {
      this.loaded = true;
    }
  }

  private requireLoaded(): void {
    if (!this.loaded) throw new Error("Pending ask store must be loaded before use");
  }

  private schedulePersist(): void {
    if (this.persistence === undefined) return;
    this.persistenceWorker = this.persistenceWorker.then(() => this.persist()).catch((error: unknown) => {
      this.reportPersistenceError("save", error);
    });
  }

  private async persist(): Promise<void> {
    if (this.persistence === undefined) return;
    const asks: PendingAskPersistedEntry[] = [...this.openBySessionId.entries()]
      .map(([sessionId, ask]) => ({ sessionId, ask: cloneAsk(ask) }));
    const state: PendingAskPersistedState = { version: PENDING_ASK_STATE_VERSION, asks };
    await this.persistence.save(state);
  }

  private reportPersistenceError(operation: "load" | "save", error: unknown): void {
    try {
      this.onPersistenceError(operation, error);
    } catch {
      // Error reporting must not poison serialized persistence work.
    }
  }

  /** The session's open ask, for {@link SessionStatus} projection. */
  pendingAsk(sessionId: string): PendingAskUser | undefined {
    this.requireLoaded();
    const ask = this.openBySessionId.get(requireSessionId(sessionId));
    return ask === undefined ? undefined : cloneAsk(ask);
  }

  open(input: PendingAskOpenInput): PendingAskOpenResult {
    this.requireLoaded();
    const sessionId = requireSessionId(input.sessionId);
    const questions = validateQuestions(input.questions);
    const askedAt = this.timestamp();
    const superseded = this.close(sessionId, "superseded", askedAt, new Map());
    const ask: PendingAskUser = {
      askId: requireId(this.createAskId(), "askId"),
      askedAt,
      questions,
    };
    this.openBySessionId.set(sessionId, ask);
    this.schedulePersist();
    return {
      ask: cloneAsk(ask),
      ...(superseded === undefined ? {} : { superseded }),
    };
  }

  /**
   * Record what the user replied and close the ask. Answers are validated against
   * the open ask, so a submission that does not fit its questions is rejected
   * rather than silently truncated; the ask stays open in that case.
   */
  submit(sessionId: string, askId: string, submission: AskUserSubmission): PendingAskCloseResult {
    const ask = this.openBySessionId.get(requireSessionId(sessionId));
    if (ask?.askId !== askId) return { status: "stale" };
    // Validate before closing so a submission that does not fit its questions
    // leaves the ask open for the browser to correct.
    const answers = validateSubmission(ask, submission);
    const result = { status: "closed" as const, outcome: this.requireClose(sessionId, "submitted", answers) };
    this.schedulePersist();
    return result;
  }

  /**
   * Close the session's open ask without a submission. The outcome reports every question as
   * unanswered, because answers only ever reach the daemon through a submit.
   */
  cancel(sessionId: string, askId: string): PendingAskCloseResult {
    const ask = this.openBySessionId.get(requireSessionId(sessionId));
    if (ask?.askId !== askId) return { status: "stale" };
    const result = { status: "closed" as const, outcome: this.requireClose(sessionId, "cancelled", new Map()) };
    this.schedulePersist();
    return result;
  }

  /**
   * Close whatever ask the session currently has open, e.g. because the user sent
   * an ordinary chat message instead of answering the form. Returns the outcome,
   * or `undefined` when the session has no open ask.
   */
  cancelOpen(sessionId: string): AskUserOutcome | undefined {
    const outcome = this.close(requireSessionId(sessionId), "cancelled", this.timestamp(), new Map());
    this.schedulePersist();
    return outcome;
  }

  /** Drop the open ask of a session that is going away, without reporting an outcome. */
  forgetSession(sessionId: string): void {
    this.openBySessionId.delete(requireSessionId(sessionId));
    this.schedulePersist();
  }

  private requireClose(sessionId: string, reason: AskUserCloseReason, answers: RecordedAnswers): AskUserOutcome {
    const outcome = this.close(sessionId, reason, this.timestamp(), answers);
    if (outcome === undefined) throw new Error(`Pending ask of session ${sessionId} disappeared while closing`);
    return outcome;
  }

  private close(
    sessionId: string,
    reason: AskUserCloseReason,
    closedAt: string,
    answers: RecordedAnswers,
  ): AskUserOutcome | undefined {
    const ask = this.openBySessionId.get(sessionId);
    if (ask === undefined) return undefined;
    this.openBySessionId.delete(sessionId);
    return askUserOutcome(ask, answers, reason, closedAt);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

/**
 * Model-facing text of a closed ask. The model reads this, so it must name the
 * unanswered questions as plainly as the answered ones.
 */
export function renderAskUserAnswersText(outcome: AskUserOutcome): string {
  const lead = outcome.reason === "submitted"
    ? "The user submitted answers to your questions."
    : `The question set was closed (${outcome.reason}) before it was fully answered.`;
  return [lead, "", ...outcome.questions.map(questionLines).flat(), "", outcome.summary].join("\n");
}

/**
 * Notice for the model when a new ask replaced one the user never answered, so a
 * supersede is never a silent loss of the earlier questions.
 */
export function renderSupersededAskText(outcome: AskUserOutcome): string {
  return [
    `This replaced an earlier question set (${outcome.askId}) that the user never submitted.`,
    `Left unanswered: ${outcome.unansweredIds.join(", ")}.`,
  ].join("\n");
}

function questionLines(record: AskUserQuestionRecord): string[] {
  const header = `- ${record.question.id}: ${record.question.question}`;
  if (!record.answered) return [header, "  Unanswered."];
  const parts = [...record.values.map((value) => `selected ${value}`)];
  if (record.otherText !== undefined) parts.push(`custom: ${JSON.stringify(record.otherText)}`);
  return [header, `  Answered: ${parts.join("; ")}`];
}

function askUserOutcome(
  ask: PendingAskUser,
  answers: RecordedAnswers,
  reason: AskUserCloseReason,
  closedAt: string,
): AskUserOutcome {
  const questions = ask.questions.map((question) => questionRecord(question, answers.get(question.id)));
  const unansweredIds = questions.filter((record) => !record.answered).map((record) => record.question.id);
  const answeredCount = questions.length - unansweredIds.length;
  return {
    askId: ask.askId,
    reason,
    askedAt: ask.askedAt,
    closedAt,
    questions,
    answeredCount,
    unansweredIds,
    summary: summaryLine(questions.length, answeredCount, unansweredIds),
  };
}

function questionRecord(question: AskUserQuestion, answer: AskUserAnswer | undefined): AskUserQuestionRecord {
  const values = answer?.values ?? [];
  const otherText = answer?.otherText;
  return {
    question: cloneQuestion(question),
    answered: values.length > 0 || otherText !== undefined,
    values: [...values],
    ...(otherText === undefined ? {} : { otherText }),
  };
}

function summaryLine(total: number, answeredCount: number, unansweredIds: string[]): string {
  const answered = `Answered ${answeredCount.toString()} of ${total.toString()}`;
  return unansweredIds.length === 0 ? `${answered}; none left unanswered` : `${answered}; unanswered: ${unansweredIds.join(", ")}`;
}

function validateQuestions(questions: AskUserQuestion[]): AskUserQuestion[] {
  if (questions.length === 0) throw new PendingAskValidationError("An ask must contain at least one question");
  if (questions.length > ASK_USER_QUESTION_LIMIT) {
    throw new PendingAskValidationError(`An ask must not contain more than ${ASK_USER_QUESTION_LIMIT.toString()} questions`);
  }
  const seenIds = new Set<string>();
  return questions.map((question) => {
    const id = requireId(question.id, "question id");
    if (seenIds.has(id)) throw new PendingAskValidationError(`Duplicate question id ${id}`);
    seenIds.add(id);
    return validateQuestion(question, id);
  });
}

function validateQuestion(question: AskUserQuestion, id: string): AskUserQuestion {
  if (question.options.length > ASK_USER_OPTION_LIMIT) {
    throw new PendingAskValidationError(`Question ${id} must not offer more than ${ASK_USER_OPTION_LIMIT.toString()} options`);
  }
  const seenValues = new Set<string>();
  const options = question.options.map((option) => {
    const value = requireId(option.value, `option value of question ${id}`);
    if (seenValues.has(value)) throw new PendingAskValidationError(`Duplicate option value ${value} in question ${id}`);
    seenValues.add(value);
    return validateOption(option, value, id);
  });
  const detail = question.detail;
  return {
    id,
    question: requireText(question.question, `text of question ${id}`),
    ...(detail === undefined ? {} : { detail: requireText(detail, `detail of question ${id}`) }),
    options,
    ...(question.multiple === true ? { multiple: true } : {}),
  };
}

function validateOption(option: AskUserQuestionOption, value: string, questionId: string): AskUserQuestionOption {
  const detail = option.detail;
  return {
    value,
    label: requireText(option.label, `label of option ${value} in question ${questionId}`),
    ...(detail === undefined ? {} : { detail: requireText(detail, `detail of option ${value} in question ${questionId}`) }),
  };
}

function validateSubmission(ask: PendingAskUser, submission: AskUserSubmission): Map<string, AskUserAnswer> {
  const questionsById = new Map(ask.questions.map((question) => [question.id, question]));
  const answers = new Map<string, AskUserAnswer>();
  for (const answer of submission.answers) {
    const question = questionsById.get(answer.id);
    if (question === undefined) throw new PendingAskValidationError(`Unknown question id ${answer.id}`);
    if (answers.has(answer.id)) throw new PendingAskValidationError(`Duplicate answer for question ${answer.id}`);
    const validated = validateAnswer(question, answer);
    // Untouched questions and explicitly empty answers are the same thing, so an
    // empty answer is dropped rather than recorded as answered.
    if (validated !== undefined) answers.set(answer.id, validated);
  }
  return answers;
}

function validateAnswer(question: AskUserQuestion, answer: AskUserAnswer): AskUserAnswer | undefined {
  const optionValues = new Set(question.options.map((option) => option.value));
  const values: string[] = [];
  for (const value of answer.values) {
    if (!optionValues.has(value)) throw new PendingAskValidationError(`Question ${question.id} has no option ${value}`);
    if (values.includes(value)) throw new PendingAskValidationError(`Duplicate value ${value} for question ${question.id}`);
    values.push(value);
  }
  const otherText = normalizeOtherText(question, answer.otherText);
  const selectionCount = values.length + (otherText === undefined ? 0 : 1);
  if (question.multiple !== true && selectionCount > 1) {
    throw new PendingAskValidationError(`Question ${question.id} accepts a single answer`);
  }
  if (selectionCount === 0) return undefined;
  return { id: question.id, values, ...(otherText === undefined ? {} : { otherText }) };
}

function normalizeOtherText(question: AskUserQuestion, otherText: string | undefined): string | undefined {
  if (otherText === undefined) return undefined;
  if (otherText.length > ASK_USER_OTHER_TEXT_MAX_LENGTH) {
    throw new PendingAskValidationError(`Other text of question ${question.id} exceeds its length limit`);
  }
  const trimmed = otherText.trim();
  return trimmed === "" ? undefined : trimmed;
}

function cloneAsk(ask: PendingAskUser): PendingAskUser {
  return { askId: ask.askId, askedAt: ask.askedAt, questions: ask.questions.map(cloneQuestion) };
}

function cloneQuestion(question: AskUserQuestion): AskUserQuestion {
  return { ...question, options: question.options.map((option) => ({ ...option })) };
}

function requireSessionId(sessionId: string): string {
  if (sessionId === "") throw new Error("sessionId must not be empty");
  return sessionId;
}

/** Validate a persisted ask against the current schema; throws on a malformed entry. */
function normalizePersistedAsk(value: unknown): PendingAskUser {
  if (!isPendingAskUser(value)) throw new PendingAskValidationError("persisted ask has an unexpected shape");
  return value;
}

function isPendingAskUser(value: unknown): value is PendingAskUser {
  if (!isRecord(value)) return false;
  if (typeof value["askId"] !== "string" || value["askId"].trim() === "") return false;
  if (typeof value["askedAt"] !== "string" || value["askedAt"].trim() === "") return false;
  return isAskUserQuestions(value["questions"]);
}

function isAskUserQuestions(value: unknown): value is AskUserQuestion[] {
  return Array.isArray(value) && value.every(isAskUserQuestion);
}

function isAskUserQuestion(value: unknown): value is AskUserQuestion {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string" || value["id"].trim() === "") return false;
  if (typeof value["question"] !== "string" || value["question"].trim() === "") return false;
  if (!isAskUserOptions(value["options"])) return false;
  if (value["detail"] !== undefined && typeof value["detail"] !== "string") return false;
  if (value["multiple"] !== undefined && typeof value["multiple"] !== "boolean") return false;
  return true;
}

function isAskUserOptions(value: unknown): value is AskUserQuestionOption[] {
  return Array.isArray(value) && value.every((option) => {
    if (!isRecord(option)) return false;
    if (typeof option["value"] !== "string" || option["value"].trim() === "") return false;
    if (typeof option["label"] !== "string" || option["label"].trim() === "") return false;
    if (option["detail"] !== undefined && typeof option["detail"] !== "string") return false;
    return true;
  });
}

/** Validate the file envelope and return its raw entries; per-entry validation happens separately so one bad ask cannot drop the rest. */
function parsePersistedEntries(value: unknown): { sessionId: string; ask: unknown }[] {
  const record = requireObject(value, "Session pending ask state must be an object");
  if (record["version"] !== PENDING_ASK_STATE_VERSION) throw new Error("Unsupported session pending ask state version");
  const rawAsks = record["asks"];
  if (!Array.isArray(rawAsks)) throw new Error("Session pending ask entries must be an array");
  return rawAsks.map((entry) => {
    const rec = requireObject(entry, "Session pending ask entry must be an object");
    const sessionId = typeof rec["sessionId"] === "string" ? rec["sessionId"] : "";
    requireSessionId(sessionId);
    return { sessionId, ask: rec["ask"] };
  });
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireId(value: string, field: string): string {
  if (value.trim() === "") throw new PendingAskValidationError(`${field} must not be empty`);
  if (value.length > ASK_USER_ID_MAX_LENGTH) throw new PendingAskValidationError(`${field} exceeds its length limit`);
  return value;
}

function requireText(value: string, field: string): string {
  if (value.trim() === "") throw new PendingAskValidationError(`${field} must not be empty`);
  if (value.length > ASK_USER_TEXT_MAX_LENGTH) throw new PendingAskValidationError(`${field} exceeds its length limit`);
  return value;
}
