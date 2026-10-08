import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequestError, NetworkRequestError, request } from "./http";

const fetchMock = vi.fn<typeof fetch>();
const transportStages: ("fetch" | "body")[] = ["fetch", "body"];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function rejectTransport(stage: "fetch" | "body", error: unknown): void {
  if (stage === "fetch") {
    fetchMock.mockRejectedValue(error);
  } else {
    const response = new Response("{}");
    vi.spyOn(response, "text").mockRejectedValue(error);
    fetchMock.mockResolvedValue(response);
  }
}

describe.each(transportStages)("request %s transport boundary", (stage) => {
  it("classifies TypeError with its original cause and message", async () => {
    const cause = new TypeError("Failed to fetch");
    rejectTransport(stage, cause);
    const parse = vi.fn((body: unknown) => body);

    const failure: unknown = await request("api/read", parse).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw new Error("Expected a network failure");
    expect(failure.name).toBe("NetworkRequestError");
    expect(failure.message).toBe(cause.message);
    expect(failure.cause).toBe(cause);
    expect(parse).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves AbortError cancellation", async () => {
    const cancellation = new DOMException("Request cancelled", "AbortError");
    rejectTransport(stage, cancellation);

    await expect(request("api/read", (body) => body)).rejects.toBe(cancellation);
  });

  it("does not classify a TypeError named AbortError", async () => {
    const cancellation = new TypeError("Request cancelled");
    cancellation.name = "AbortError";
    rejectTransport(stage, cancellation);

    await expect(request("api/read", (body) => body)).rejects.toBe(cancellation);
  });

  it("preserves TypeError when the signal is aborted before rejection settles", async () => {
    const controller = new AbortController();
    const cancellation = new TypeError("Request cancelled");
    rejectTransport(stage, cancellation);

    const pending = request("api/read", (body) => body, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toBe(cancellation);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves non-TypeError failures", async () => {
    const failure = new Error("Unexpected failure");
    rejectTransport(stage, failure);

    await expect(request("api/read", (body) => body)).rejects.toBe(failure);
  });
});

describe("request", () => {
  it("returns the parsed result after a successful JSON read", async () => {
    fetchMock.mockResolvedValue(new Response('{"value":1}'));
    const result = { parsed: true };
    const parse = vi.fn((body: unknown) => { void body; return result; });

    await expect(request("api/read", parse)).resolves.toBe(result);

    expect(parse).toHaveBeenCalledExactlyOnceWith({ value: 1 });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://pi.example.test/api/read", { headers: new Headers() });
  });

  it("reports a non-JSON 2xx body as a request error instead of a SyntaxError", async () => {
    fetchMock.mockResolvedValue(new Response("<!doctype html><html></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
    const parse = vi.fn((body: unknown) => body);

    const failure = request("api/read", parse);

    await expect(failure).rejects.toBeInstanceOf(HttpRequestError);
    await expect(failure).rejects.toThrow("Expected a JSON response but received text/html; charset=utf-8");
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([new TypeError("Invalid shape"), new SyntaxError("Invalid value"), new Error("Parser bug")])("preserves parser errors: %s", async (failure) => {
    fetchMock.mockResolvedValue(new Response("{}"));

    await expect(request("api/read", () => { throw failure; })).rejects.toBe(failure);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not classify URL construction TypeError as a network failure", async () => {
    vi.stubGlobal("document", { baseURI: "not a URL" });

    const pending = request("api/read", (body) => body);

    await expect(pending).rejects.toBeInstanceOf(TypeError);
    await expect(pending).rejects.not.toBeInstanceOf(NetworkRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains the HTTP status and JSON error message", async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"Access denied"}', { status: 403, statusText: "Forbidden" }));
    const parse = vi.fn((body: unknown) => body);

    const pending = request("api/read", parse);

    await expect(pending).rejects.toBeInstanceOf(HttpRequestError);
    await expect(pending).rejects.toMatchObject({ status: 403, message: "Access denied" });
    expect(parse).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to the HTTP status text when the failure body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 503, statusText: "Service Unavailable" }));

    const pending = request("api/read", (body) => body);

    await expect(pending).rejects.toBeInstanceOf(HttpRequestError);
    await expect(pending).rejects.toMatchObject({ status: 503, message: "Service Unavailable" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["GET", "POST", "PUT", "DELETE"])("never globally retries %s requests", async (method) => {
    fetchMock.mockRejectedValue(new TypeError("Offline"));

    await expect(request("api/resource", (body) => body, { method })).rejects.toBeInstanceOf(NetworkRequestError);

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
