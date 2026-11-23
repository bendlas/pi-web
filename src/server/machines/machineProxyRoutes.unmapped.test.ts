import { Readable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import type { MachineClient } from "./machineClient.js";
import type { MachineService } from "./machineService.js";
import { registerMachineProxyRoutes } from "./machineProxyRoutes.js";

let app: FastifyInstance;
let request: MockedFunction<MachineClient["request"]>;
let remoteClient: MockedFunction<MachineService["remoteClient"]>;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  request = vi.fn<MachineClient["request"]>();
  const client: MachineClient = {
    request,
    requestJson: () => Promise.reject(new Error("JSON requests are not expected")),
    connectWebSocket: () => { throw new Error("WebSockets are not expected"); },
  };
  remoteClient = vi.fn<MachineService["remoteClient"]>(() => Promise.resolve(client));
  registerMachineProxyRoutes(app, { remoteClient, invalidateReportedName: vi.fn() });
});

afterEach(async () => {
  app.server.closeAllConnections();
  await app.close();
});

describe("federated unmapped-session history", () => {
  it("proxies the unmapped index to the remote machine", async () => {
    const body = { generatedAt: "2026-01-01T00:00:00.000Z", groups: [] };
    request.mockResolvedValue({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Readable.from([Buffer.from(JSON.stringify(body))]),
    });

    const response = await app.inject({ method: "GET", url: "/api/machines/remote/sessions/unmapped" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(body);
    expect(remoteClient).toHaveBeenCalledWith("remote");
    expect(request.mock.calls[0]?.slice(0, 3)).toEqual(["GET", "/api/sessions/unmapped", undefined]);
  });
});