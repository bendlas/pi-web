import { resolveAppUrl } from "../appUrl";

/** A response-backed API failure, retaining the status needed at an ownership boundary. */
export class HttpRequestError extends Error {
  override name = "HttpRequestError";

  constructor(message: string, readonly status: number, options: ErrorOptions = {}) {
    super(message, options);
  }
}

export async function request<T>(url: string, parse: (value: unknown) => T, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(resolveAppUrl(url), { ...init, headers });
  const text = await response.text();
  if (!response.ok) {
    throw new HttpRequestError(errorMessage(parseJson(text)) ?? response.statusText, response.status);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // A 2xx non-JSON body (an app shell, login redirect, or proxy error page)
    // must surface as a clear request failure, not a raw `SyntaxError`.
    const contentType = response.headers.get("content-type") ?? "an unknown content type";
    throw new HttpRequestError(`Expected a JSON response but received ${contentType}`, response.status);
  }
  return parse(body);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value["error"] === "string" ? value["error"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
