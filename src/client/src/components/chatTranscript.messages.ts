import { message } from "../localization/service";

export default {
  role: message<{ role: string }>("{role, select, user {user} assistant {assistant} tool {tool} system {system} bash {shell} other {skill}}", "Message role heading; role is user, assistant, tool, system, bash or skill"),
  toolOutput: message<{ name: string; named: string }>("{named, select, yes {{name} output} other {tool output}}", "Tool-image output heading; name is a raw tool identifier"),
  toolImage: message<{ name: string; named: string; index: number; total: number }>("{named, select, yes {{name} output image {index, number} of {total, number}} other {Tool output image {index, number} of {total, number}}}", "Tool-image accessible description, including its position across all outputs"),
  sources: message<{ count: number }>("Sources ({count, number})", "Disclosure of tool-image source messages"),
  output: message<{ index: number }>("Output {index, number}", "Accessible source-message section name"),
  sourceHeader: message<{ name: string; named: string; index: number }>("{named, select, yes {{name} output · {index, number}} other {tool output · {index, number}}}", "Numbered tool-image source heading"),
  groupLabel: message<{ live: string }>("{live, select, yes {live events} other {events}}", "Activity group heading, independent of disclosure state"),
  groupSummary: message<{ kind: string; count: number; roles: string }>("{kind, select, compaction {{count, plural, one {# history compaction summary} other {# history compaction summaries}}} branch {{count, plural, one {# branch summary} other {# branch summaries}}} other {{count, plural, one {# event} other {# events}} · {roles}}}", "Activity group summary; roles is a locale-formatted list of role counts"),
  roleCount: message<{ role: string; count: number }>("{role, select, user {{count, number} user} assistant {{count, number} assistant} tool {{count, number} tool} system {{count, number} system} bash {{count, number} shell} other {{count, number} skill}}", "Count of events of one role in an activity group"),
  information: message("Message information", "Show metadata for this message"),
  actions: message("Message actions", "Message action menu and action toolbar accessible name"),
  noMetadata: message("No Pi message metadata available", "Fallback for a message with no valid timestamp, model or thinking level"),
  thinking: message("Thinking", "Disclosure of raw model thinking text"),
  skill: message("[skill]", "Skill invocation disclosure prefix, followed by a raw skill name"),
  loadedSkill: message<{ name: string }>("Loaded {name}", "Skill-read status; name is a raw skill identifier"),
  readSkill: message<{ path: string }>("read {path}", "Skill-read source path; path is not translated"),
  toolResult: message<{ name: string; failed: string }>("{failed, select, yes {{name} result · Failed} other {{name} result}}", "Tool-result disclosure; name is a raw tool identifier"),
};
