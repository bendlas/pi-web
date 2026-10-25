import { message } from "../../../shared/localization";

export default {
  sending: message("Sending your message…", "Conversation activity while a prompt is being sent"),
  compacting: message("compacting", "Conversation status while compacting history"),
  bash: message("bash", "Conversation status while running a shell command"),
  running: message("running", "Conversation status while the agent is working"),
  queued: message("queued", "Conversation status while messages are queued"),
  summary: message<{ label: string; detail: string }>("{label}: {detail}", "Conversation activity summary; label and detail can be raw runtime-provided text"),
};
