import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequestError, request } from "./http";

beforeEach(() => {
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response): void {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(response)));
}

describe("request", () => {
  it("parses a JSON success body", async () => {
    stubFetch(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(request("api/example", (value) => value)).resolves.toEqual({ ok: true });
  });

  it("reports a non-JSON 2xx body as a request error instead of a SyntaxError", async () => {
    stubFetch(new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));

    const failure = request("api/example", (value) => value);
    await expect(failure).rejects.toBeInstanceOf(HttpRequestError);
    await expect(failure).rejects.toThrow("Expected a JSON response but received text/html; charset=utf-8");
  });

  it("surfaces the JSON error message from a failed response", async () => {
    stubFetch(new Response(JSON.stringify({ error: "Path does not exist" }), { status: 400, headers: { "content-type": "application/json" } }));

    const failure = request("api/example", (value) => value);
    await expect(failure).rejects.toBeInstanceOf(HttpRequestError);
    await expect(failure).rejects.toThrow("Path does not exist");
    await expect(failure).rejects.toMatchObject({ status: 400 });
  });

  it("falls back to the status text when a failed response is not JSON", async () => {
    stubFetch(new Response("<html>login</html>", { status: 401, statusText: "Unauthorized", headers: { "content-type": "text/html" } }));

    await expect(request("api/example", (value) => value)).rejects.toThrow("Unauthorized");
  });
});
