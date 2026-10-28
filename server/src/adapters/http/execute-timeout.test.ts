import { createServer, type Server, type ServerResponse } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "../types.js";
import { execute } from "./execute.js";

// Keep this socket regression independent of the server logger and database.
vi.mock("../utils.js", () => ({
  asString: (value: unknown, fallback: string) => typeof value === "string" ? value : fallback,
  asNumber: (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback,
  parseObject: (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value : {},
}));

const network = vi.hoisted(() => ({ lookup: vi.fn(), socketFactory: vi.fn() }));
vi.mock("./remote-fetch.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./remote-fetch.js")>();
  return {
    ...original,
    guardedHttpAdapterFetch: (
      url: Parameters<typeof original.guardedHttpAdapterFetch>[0],
      init: RequestInit,
      options: Parameters<typeof original.guardedHttpAdapterFetch>[2] = {},
    ) => original.guardedHttpAdapterFetch(url, init, { ...options, ...network }),
  };
});

let server: Server | undefined;
const sockets = new Set<Socket>();
afterEach(async () => {
  vi.useRealTimers();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  network.lookup.mockReset();
  network.socketFactory.mockReset();
});

async function silentEndpoint() {
  let respond!: (response: ServerResponse) => void;
  const received = new Promise<ServerResponse>((resolve) => { respond = resolve; });
  server = createServer((_request, response) => respond(response));
  server.on("connection", (socket) => sockets.add(socket));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  network.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  network.socketFactory.mockImplementation(() => {
    // Use the same DNS-pinning test seam as remote-http-rebinding.test.ts.
    const socket = connect({ host: "127.0.0.1", port });
    Object.defineProperty(socket, "remoteAddress", { get: () => "93.184.216.34" });
    sockets.add(socket);
    return socket;
  });
  return { received };
}

function context(timeoutMs?: number): AdapterExecutionContext {
  return {
    runId: "run-deadline",
    agent: { id: "agent", companyId: "company", name: "Callback", adapterType: "http", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { url: "http://callback.deadline.test/run/quinn", payloadMode: "callback_v1", timeoutMs },
    context: { issueId: "issue", taskId: "issue" },
    onLog: async () => {},
  };
}

describe("HTTP callback response deadline", () => {
  it("allows a pinned hostname callback to finish after 30s within its 150s budget", async () => {
    const { received } = await silentEndpoint();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let settled = false;
    const result = execute(context(150_000)).finally(() => { settled = true; });
    // Observe rejections immediately so the old 30s failure is not unhandled.
    void result.catch(() => {});
    const response = await received;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(settled).toBe(false);
    response.writeHead(200);
    response.end("{}");
    await expect(result).resolves.toMatchObject({ exitCode: 0, timedOut: false });
    expect(network.lookup).toHaveBeenCalledOnce();
    expect(network.socketFactory).toHaveBeenCalledOnce();
  });

  it("still stops at the configured total deadline", async () => {
    const { received } = await silentEndpoint();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const result = execute(context(1_000));
    await received;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toMatchObject({ timedOut: true, errorCode: "timeout" });
  });

  it("retains the 30s transport default when no adapter deadline is configured", async () => {
    const { received } = await silentEndpoint();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const failure = execute(context()).catch((error: unknown) => error);
    await received;
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(failure).resolves.toMatchObject({ code: "remote_http_response_timeout" });
  });
});
