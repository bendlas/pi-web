/** The message-header label used when a tool message renders as an image output. */
export function chatToolOutputLabel(toolName?: string): string {
  return toolName === undefined || toolName === "" ? "tool output" : `${toolName} output`;
}

// `live` marks the growing tail group while the session is active. It is
// independent of whether the group is expanded by default, so quiet mode keeps
// the same label and class as the ordinary transcript.
export function chatMessageGroupClassName(live: boolean): string {
  return live ? "msg event-group live" : "msg event-group";
}

export function chatMessageGroupLabel(live: boolean): string {
  return live ? "live events" : "events";
}
