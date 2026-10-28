import { Type } from "pi-web-typebox";
import { KNOWN_THINKING_LEVELS } from "../../shared/thinkingLevels.js";
import { defineTool, type ExtensionContext } from "../../piSdk.js";
import type { TranscriptContentKind, TranscriptEntry, TranscriptRole, TranscriptView } from "./subsessionTranscript.js";
import { renderSubsessionCompletions, type SubsessionCompletion } from "./subsessionCompletionInbox.js";

/** Lifecycle phase of a tracked subsession as seen by its parent. */
export type SubsessionStatus = "working" | "idle" | "error" | "unknown";

export interface SpawnSubsessionResult {
  sessionId: string;
  cwd: string;
  /** Model the child session runs with, as `provider/id`; absent when unknown. */
  model?: string;
}

export type SpawnSubsessionModel = NonNullable<ExtensionContext["model"]>;
export type SpawnSubsessionThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;

export interface SpawnSubsessionInvocation {
  /**
   * cwd of the session that invoked the tool. A tracked child always runs in
   * this workspace, so it is both the project-scope check input and the target.
   */
  spawningCwd: string;
  /** Session id of the parent; the spawned session is tracked against it. */
  parentSessionId: string;
  /** Session file of the parent, recorded in the child's `parentSession` header. */
  parentSessionFile: string | undefined;
  prompt: string;
  /**
   * Requested target workspace for the tracked child. May be any workspace
   * (worktree, or root) of the same project as the spawning session; the server
   * resolves and validates it, so the child stays visible in the web UI. When
   * omitted, the child runs in the spawning session's own working directory.
   */
  cwd?: string;
  /** Current model from the dispatching session, used as the spawned session's default. */
  model?: SpawnSubsessionModel;
  /** Strict `provider/model-id` requested by the parent; overrides {@link model} when set. */
  modelSpec?: string;
  /** Explicit override or parent's inherited thinking level (pi clamps it to the child model's capabilities). */
  thinkingLevel?: SpawnSubsessionThinkingLevel;
}

export interface SubsessionSummary {
  sessionId: string;
  cwd: string;
  status: SubsessionStatus;
}

/** Quick glance at a subsession: status plus its most recent assistant output. */
export interface SubsessionCheckResult {
  sessionId: string;
  cwd: string;
  status: SubsessionStatus;
  finalText: string;
  messageCount: number;
  errorDetail?: string;
}

export interface SubsessionJoinResult {
  subsessions: SubsessionSummary[];
  completions: SubsessionCompletion[];
}

/** Exploratory transcript read: a filtered, paginated slice of the subsession's history. */
export interface SubsessionReadResult extends TranscriptView {
  sessionId: string;
  cwd: string;
  status: SubsessionStatus;
  errorDetail?: string;
}

/** Filters the parent passes to narrow a transcript read; mirrors {@link TranscriptQuery}. */
export interface SubsessionReadQuery {
  roles?: TranscriptRole[];
  include?: TranscriptContentKind[];
  search?: string;
  maxChars?: number;
  includeToolArgs?: boolean;
  before?: number;
  limit?: number;
}

/**
 * Outcome of steering a tracked child. `status` is the child's state when the
 * message was accepted: `working` children receive it as a steering message,
 * `idle` ones as a new turn.
 */
export interface SteerSubsessionResult {
  sessionId: string;
  cwd: string;
  status: SubsessionStatus;
}

export interface SubsessionToolDeps {
  spawn(input: SpawnSubsessionInvocation): Promise<SpawnSubsessionResult>;
  list(parentSessionId: string, parentSessionFile?: string): Promise<SubsessionSummary[]>;
  join(parentSessionId: string, parentSessionFile?: string, toolCallId?: string): Promise<SubsessionJoinResult>;
  check(parentSessionId: string, sessionId: string, parentSessionFile?: string, toolCallId?: string): Promise<SubsessionCheckResult>;
  read(parentSessionId: string, sessionId: string, query: SubsessionReadQuery, parentSessionFile?: string, toolCallId?: string): Promise<SubsessionReadResult>;
  steer(parentSessionId: string, sessionId: string, text: string, parentSessionFile?: string): Promise<SteerSubsessionResult>;
}

const SpawnSubsessionParams = Type.Object({
  thinkingLevel: Type.Optional(Type.Enum(KNOWN_THINKING_LEVELS, {
    type: "string",
    description: "Thinking level override for the child session. Set this field only when instructed to use a specific thinking level or to choose an appropriate one. Otherwise omit it to inherit this session's thinking level. An unknown value is rejected; valid levels are clamped to the selected model's capabilities.",
  })),
  prompt: Type.String({
    description: "Initial instruction for the tracked child.",
  }),
  cwd: Type.Optional(Type.String({
    description: "Working directory for the child session. Must be a workspace (worktree, or root) of the same project as this session. Defaults to this session's working directory.",
  })),
  model: Type.Optional(Type.String({
    description: 'Model override for the child session, as an exact "provider/model-id". Set this field only when instructed to use a specific model or to choose an appropriate one. Otherwise omit it to inherit this session\'s model. An unknown value is rejected.',
  })),
});

const ListSubsessionsParams = Type.Object({});
const YieldToSubsessionsParams = Type.Object({});
const WaitSubsessionsParams = Type.Object({
  timeout: Type.Optional(Type.Number({
    description: "Seconds before the wait gives up and returns (default: 1800).",
    minimum: 1,
    maximum: 86400,
  })),
});

/** How often the blocking wait re-checks for a child result. */
const WAIT_POLL_MS = 750;
const DEFAULT_WAIT_TIMEOUT_SECONDS = 1800;

/** Sleep that rejects promptly when the tool call is aborted. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      reject(new Error("aborted"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const CheckSubsessionParams = Type.Object({
  sessionId: Type.String({
    description: "Tracked child id from spawn_subsession or list_subsessions.",
  }),
});

const ReadSubsessionParams = Type.Object({
  sessionId: Type.String({
    description: "Tracked child id from spawn_subsession or list_subsessions.",
  }),
  roles: Type.Optional(Type.Array(
    Type.Union([Type.Literal("assistant"), Type.Literal("user"), Type.Literal("tool"), Type.Literal("system"), Type.Literal("custom")]),
    { description: "Roles to include; omit for all." },
  )),
  include: Type.Optional(Type.Array(
    Type.Union([Type.Literal("text"), Type.Literal("thinking"), Type.Literal("tool_call"), Type.Literal("tool_result"), Type.Literal("image")]),
    { description: "Content kinds to include; omit for all." },
  )),
  search: Type.Optional(Type.String({
    description: "Case-insensitive text or tool-name substring; searches full content before maxChars truncation.",
  })),
  maxChars: Type.Optional(Type.Integer({
    minimum: 0,
    description: "Maximum characters per text, thinking, or tool-result value; omit for no truncation.",
  })),
  includeToolArgs: Type.Optional(Type.Boolean({
    description: "Include raw tool-call arguments; summaries are always included.",
  })),
  before: Type.Optional(Type.Integer({
    minimum: 0,
    description: "Return messages before this index; use the previous start to page backward.",
  })),
  limit: Type.Optional(Type.Integer({
    minimum: 1,
    description: "Maximum recent matches, in chronological order. Defaults to 50.",
  })),
});

const SteerSubsessionParams = Type.Object({
  sessionId: Type.String({
    description: "Tracked child id from spawn_subsession or list_subsessions.",
  }),
  text: Type.String({
    description: "Steering message for the child. A working child receives it after its current turn finishes its tool calls, before its next model call; an idle child receives it as a new turn.",
  }),
});

function statusLine(summary: SubsessionSummary): string {
  return `- ${summary.sessionId} [${summary.status}] in ${summary.cwd}`;
}

function workingInspectionGuidance(sessionId: string): string {
  return `Subsession ${sessionId} is working; partial output is withheld. Continue other work, call wait_subsessions to block until a result arrives, or call yield_to_subsessions alone and last to end the run; do not poll.`;
}

function renderEntry(entry: TranscriptEntry): string {
  const header = `#${String(entry.index)} ${entry.role}`;
  const body = entry.parts.map(renderPart).filter((line) => line !== "").join("\n");
  return body === "" ? header : `${header}\n${body}`;
}

function clipNotice(part: TranscriptEntry["parts"][number]): string {
  if ((part.kind === "text" || part.kind === "thinking" || part.kind === "tool_result") && part.truncated !== undefined) {
    return ` [+${String(part.truncated.full - part.truncated.shown)} chars truncated]`;
  }
  return "";
}

function renderPart(part: TranscriptEntry["parts"][number]): string {
  if (part.kind === "text") return `${part.text}${clipNotice(part)}`;
  if (part.kind === "thinking") return `[thinking] ${part.text}${clipNotice(part)}`;
  if (part.kind === "tool_call") {
    // Raw args are only present when the caller asked (includeToolArgs); when
    // present, surface them in the model-facing text, not just `details`.
    const args = "args" in part && part.args !== undefined ? `\n  args: ${JSON.stringify(part.args)}` : "";
    return `[tool ${part.toolName}] ${part.summary}${args}`;
  }
  if (part.kind === "tool_result") return `[result${part.isError ? " error" : ""}${part.toolName === undefined ? "" : ` ${part.toolName}`}] ${part.text}${clipNotice(part)}`;
  return "[image]";
}

function renderTranscript(result: SubsessionReadResult): string {
  const last = result.entries[result.entries.length - 1];
  // Distinguish "nothing matched at all" (widen filters) from "matches exist but
  // this page/window is empty" (page differently) so the agent isn't misled.
  const range = last === undefined
    ? (result.matched === 0
      ? "no messages matched your filters"
      : `no messages in this window (${String(result.matched)} matched outside it)`)
    : `messages ${String(result.start)}–${String(last.index)} of ${String(result.total)} (${String(result.matched)} matched)`;
  const more = result.hasMore ? ` Earlier matching messages exist before index ${String(result.start)}.` : "";
  // Empty entries with matches means the `before` cursor excluded every match
  // (they all sit at index >= before): the agent paged too far back and should
  // raise `before` or omit it, not page back further.
  const body = result.entries.length > 0
    ? result.entries.map(renderEntry).join("\n\n")
    : (result.matched === 0
      ? "(no messages matched the filters)"
      : `(no messages before index ${String(result.start)}; all ${String(result.matched)} matches have later indexes)`);
  const error = result.errorDetail === undefined ? "" : `Error: ${result.errorDetail}\n\n`;
  return `Subsession ${result.sessionId} [${result.status}] — ${range}.${more}\n\n${error}--- SUBSESSION TRANSCRIPT: ${result.sessionId} ---\n${body}`;
}

/**
 * Tools that let an agent spawn *tracked* child sessions, inspect and steer
 * them, and explicitly yield at a join point.
 *
 * A subsession records its parent in its session header, the parent is notified
 * when it stops working, and the parent may read its transcript/result. The
 * tools are constructed per-session, carrying the spawning cwd, which is both
 * the project-scope validation input and the child's workspace; the parent's
 * identity is taken from the live extension context at call time.
 */
export function createSubsessionToolDefinitions(spawningCwd: string, deps: SubsessionToolDeps) {
  const spawnTool = defineTool<typeof SpawnSubsessionParams, SpawnSubsessionResult>({
    name: "spawn_subsession",
    label: "Spawn subsession",
    description: "Start a tracked child session in this session's working directory (or another workspace of this project) to carry out part of the current task and return immediately. Its transcript and result are available here after it finishes.",
    promptSnippet: "spawn_subsession: tracked child work in a workspace of this project; result available after completion",
    parameters: SpawnSubsessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const thinkingLevel = params.thinkingLevel ?? ctx.thinkingLevel;
      const result = await deps.spawn({
        spawningCwd,
        parentSessionId,
        parentSessionFile,
        prompt: params.prompt,
        ...(params.cwd === undefined ? {} : { cwd: params.cwd }),
        ...(ctx.model === undefined ? {} : { model: ctx.model }),
        ...(params.model === undefined ? {} : { modelSpec: params.model }),
        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      });
      const modelNote = result.model === undefined ? "" : ` using model ${result.model}`;
      return {
        content: [{ type: "text", text: `Started tracked subsession ${result.sessionId} in ${result.cwd}${modelNote}. Continue other work, then block with wait_subsessions or end your turn with yield_to_subsessions; do not poll.` }],
        details: result,
      };
    },
  });

  const listTool = defineTool<typeof ListSubsessionsParams, { subsessions: SubsessionSummary[] }>({
    name: "list_subsessions",
    label: "List subsessions",
    description: "List tracked child statuses. Never yields or changes control flow; do not poll.",
    promptSnippet: "list_subsessions: inspect child statuses; never yields",
    parameters: ListSubsessionsParams,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const subsessions = await deps.list(parentSessionId, parentSessionFile);
      const text = subsessions.length === 0
        ? "No tracked subsessions."
        : `Tracked subsessions:\n${subsessions.map(statusLine).join("\n")}`;
      return { content: [{ type: "text", text }], details: { subsessions } };
    },
  });

  const checkTool = defineTool<typeof CheckSubsessionParams, SubsessionCheckResult>({
    name: "check_subsession",
    label: "Check subsession",
    description: "Get a tracked child's status and latest output. Receiving a completed result marks it read, so it will not arrive again automatically. Working output is withheld. Never yields; do not poll.",
    promptSnippet: "check_subsession: inspect child status and available output; never yields",
    parameters: CheckSubsessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const result = await deps.check(parentSessionId, params.sessionId, parentSessionFile, _toolCallId);
      const body = result.finalText === "" ? "(no output yet)" : result.finalText;
      const text = result.status === "working"
        ? workingInspectionGuidance(result.sessionId)
        : `Subsession ${result.sessionId} [${result.status}].\n\n${result.errorDetail === undefined ? "" : `Error: ${result.errorDetail}\n\n`}--- SUBSESSION OUTPUT: ${result.sessionId} ---\n${body}`;
      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });

  const readTool = defineTool<typeof ReadSubsessionParams, SubsessionReadResult>({
    name: "read_subsession",
    label: "Read subsession",
    description: "Read a tracked child's filtered transcript. Returning its complete latest final output marks that completion read; filtered or historical-only reads do not. Working transcripts are withheld. Never yields; do not poll.",
    promptSnippet: "read_subsession: inspect an available child transcript; never yields",
    parameters: ReadSubsessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const { sessionId, ...query } = params;
      const result = await deps.read(parentSessionId, sessionId, query, parentSessionFile, _toolCallId);
      const text = result.status === "working"
        ? workingInspectionGuidance(result.sessionId)
        : renderTranscript(result);
      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });

  const steerTool = defineTool<typeof SteerSubsessionParams, SteerSubsessionResult>({
    name: "steer_subsession",
    label: "Steer subsession",
    description: "Send a steering message to a tracked child without waiting for it. A working child receives it after its current turn finishes its tool calls, before its next model call; an idle child receives it as a new turn. Never yields; do not poll.",
    promptSnippet: "steer_subsession: redirect a tracked child's next turn without waiting",
    parameters: SteerSubsessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const result = await deps.steer(parentSessionId, params.sessionId, params.text, parentSessionFile);
      const delivery = result.status === "working"
        ? "The steering message is delivered after its current turn's tool calls."
        : "The message starts a new turn.";
      const text = `Steered subsession ${result.sessionId} [${result.status}] in ${result.cwd}. ${delivery} Continue other work; completion notices wake you, so do not poll.`;
      return { content: [{ type: "text", text }], details: result };
    },
  });

  const yieldTool = defineTool<typeof YieldToSubsessionsParams, SubsessionJoinResult>({
    name: "yield_to_subsessions",
    // Nested tools cannot terminate the outer agent run.
    exposure: "model-only",
    label: "Yield to subsessions",
    description: "Collect unread child results at a join point. Ready results are returned and marked read. If none are ready but children are working, end this run; a new result wakes you. If nothing is outstanding, continue. Call alone and last; do not poll.",
    promptSnippet: "yield_to_subsessions: collect unread results or end the run until a result arrives; call alone and last",
    promptGuidelines: [
      "After calling spawn_subsession, continue independent work, then call yield_to_subsessions alone and last at the join point. It returns unread results now or ends the run until a result arrives; do not poll. Receiving a completed result marks it read, so it will not arrive again automatically.",
    ],
    parameters: YieldToSubsessionsParams,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const result = await deps.join(parentSessionId, parentSessionFile, _toolCallId);
      const workingIds = result.subsessions.filter(({ status }) => status === "working").map(({ sessionId }) => sessionId);
      if (result.completions.length > 0) {
        return {
          content: [{ type: "text", text: renderSubsessionCompletions(result.completions, workingIds) }],
          details: result,
        };
      }
      if (workingIds.length === 0) {
        return {
          content: [{ type: "text", text: "No unread child results; no tracked subsessions are working. Continuing." }],
          details: result,
        };
      }
      return {
        content: [{ type: "text", text: `Working: ${workingIds.join(", ")}. Ending this run; a new unread result will wake you.` }],
        details: result,
        terminate: true,
      };
    },
  });

  const waitTool = defineTool<typeof WaitSubsessionsParams, SubsessionJoinResult>({
    name: "wait_subsessions",
    // Nested tools cannot hold the outer run for an unbounded time; keep it for the model.
    exposure: "model-only",
    label: "Wait for subsessions",
    description: "Block until an unread child result arrives, then return it in this same turn. The call does not return until a child completes, the timeout elapses, or you are aborted, so it makes polling impossible. The session stays busy while blocked, so other async wake-ups are held until it returns. Use it at a join point when you have nothing else to do. To end your turn and be woken instead, use yield_to_subsessions.",
    promptSnippet: "wait_subsessions: block until a child result arrives, then continue in the same turn",
    promptGuidelines: [
      "Call wait_subsessions to block until a tracked child finishes and then keep working in the same turn. It returns only when a result arrives or it times out; do not poll list_subsessions or check_subsession around it.",
      "wait_subsessions keeps this session busy while blocked, so other async wake-ups are held until it returns. Use yield_to_subsessions when you want to end your turn and be woken instead.",
    ],
    parameters: WaitSubsessionsParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const timeoutMs = (params.timeout ?? DEFAULT_WAIT_TIMEOUT_SECONDS) * 1000;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const result = await deps.join(parentSessionId, parentSessionFile, _toolCallId);
        const workingIds = result.subsessions.filter(({ status }) => status === "working").map(({ sessionId }) => sessionId);
        if (result.completions.length > 0) {
          return {
            content: [{ type: "text", text: renderSubsessionCompletions(result.completions, workingIds) }],
            details: result,
          };
        }
        if (workingIds.length === 0) {
          return {
            content: [{ type: "text", text: "No unread child results; no tracked subsessions are working. Continuing." }],
            details: result,
          };
        }
        if (signal?.aborted) throw new Error("aborted while waiting for subsessions");
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          return {
            content: [{
              type: "text",
              text: `wait_subsessions timed out after ${String(Math.round(timeoutMs / 1000))}s. Still working: ${workingIds.join(", ")}. Call wait_subsessions again to keep waiting, or yield_to_subsessions to end the run.`,
            }],
            details: result,
          };
        }
        await abortableSleep(Math.min(WAIT_POLL_MS, remaining), signal);
      }
    },
  });

  return [spawnTool, listTool, checkTool, readTool, steerTool, yieldTool, waitTool];
}
