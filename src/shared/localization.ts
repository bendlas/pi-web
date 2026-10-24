import type { FormatXMLElementFn, PrimitiveType } from "intl-messageformat";
import type { TemplateResult } from "lit";

export type RichMessageTag = FormatXMLElementFn<TemplateResult>;
export type RichMessageValue = PrimitiveType | RichMessageTag;
export type MessageValues = Record<string, RichMessageValue>;

/** English source plus context for translators. Values are type-only metadata. */
export interface MessageDefinition<Values extends MessageValues = MessageValues> {
  readonly message: string;
  readonly description: string;
  readonly __values?: Values;
}

/** Declare values explicitly so callers get key and placeholder checking, including ICU branches. */
export function message<Values extends MessageValues = Record<string, never>>(
  source: string,
  description: string,
): MessageDefinition<NoInfer<Values>> {
  return { message: source, description };
}

export type MessageDefinitions = Readonly<Record<string, MessageDefinition>>;
export type MessageArguments<Definition> = Definition extends MessageDefinition<infer Values>
  ? Values extends Record<string, never> ? [values?: Values] : [values: Values]
  : never;

export interface LocalizedMessages<Definitions extends MessageDefinitions> {
  t<Key extends keyof Definitions & string>(key: Key, ...args: MessageArguments<Definitions[Key]>): string;
  /** Tags are caller-provided Lit callbacks; translated HTML is never interpreted. */
  rich<Key extends keyof Definitions & string>(key: Key, ...args: MessageArguments<Definitions[Key]>): string | TemplateResult | (string | TemplateResult)[];
}

export interface LocalizationPreferences {
  /** Requested UI language. Missing messages always use the English source. */
  language: string;
  /** Independent regional conventions; never implies currency or time zone. */
  formatLocale: string;
  /** Omitted means the browser/runtime's local zone. */
  timeZone?: string;
  hourCycle?: "h11" | "h12" | "h23" | "h24";
}

export type TranslationCatalog = Readonly<Record<string, string>>;
export interface TranslationContribution {
  /** Stable, globally unique owner/contribution ID. Lexically later IDs win overlaps. */
  id: string;
  namespace: string;
  locale: string;
  load(): Promise<TranslationCatalog>;
}

export interface LocalizationDiagnostic {
  code: "duplicate" | "invalid" | "missing" | "load" | "format";
  message: string;
  cause?: unknown;
}
