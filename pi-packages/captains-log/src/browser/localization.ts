import type { MessageArguments, MessageDefinition, MessageValues, PluginLocalization } from "@jmfederico/pi-web/plugin-api";
import definitions from "./captain.messages.js";

export function createCaptainContent(localization: PluginLocalization) {
  return { localization, messages: localization.registerMessages("browser", definitions) };
}
export type CaptainContent = ReturnType<typeof createCaptainContent>;
export type CaptainStaticKey = { [Key in keyof typeof definitions]: (typeof definitions)[Key] extends MessageDefinition<Record<string, never>> ? Key : never }[keyof typeof definitions];

/** English fallback for older hosts and standalone panel consumers. */
export function captainText<Key extends keyof typeof definitions>(content: CaptainContent | undefined, key: Key, ...args: MessageArguments<(typeof definitions)[Key]>): string {
  if (content !== undefined) return content.messages.t(key, ...args);
  const values: MessageValues | undefined = args[0];
  return definitions[key].message.replace(/\{(\w+)\}/gu, (_, name: string) => {
    const value = values?.[name];
    return typeof value === "string" || typeof value === "number" ? String(value) : `{${name}}`;
  });
}

/** External values stay text and cannot change the surrounding RTL message direction. */
export function captainValue(content: CaptainContent | undefined, value: string): string {
  return content?.localization.direction === "rtl" ? `\u2068${value}\u2069` : value;
}

type LocalErrorKey = "recordsUnavailable" | "invalidRecord" | "channelsUnavailable" | "invalidSnapshot";
/** Preserve origin: backend errors with identical English text are still backend values. */
export class CaptainBrowserError extends Error {
  constructor(readonly key: LocalErrorKey) { super(captainText(undefined, key)); }
}
export function captainError(content: CaptainContent | undefined, error: unknown): string {
  return error instanceof CaptainBrowserError ? captainText(content, error.key) : captainValue(content, String(error));
}
