import { readFileSync } from "node:fs";
import type { AdapterExecutionContext, AdapterRuntimeToolAccess } from "../types.js";
import { testEnvironment } from "./test.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_INTENT_AGENT_GUIDANCE } from "@paperclipai/shared";
import { execute } from "./execute.js";

const guardedFetchMock = vi.hoisted(() => vi.fn());

vi.mock("./remote-fetch.js", () => ({
  guardedHttpAdapterFetch: guardedFetchMock,
}));

afterEach(() => {
  guardedFetchMock.mockReset();
});

describe("http adapter execute", () => {
  it.each([undefined, "agent"])("delivers the complete runtime connection descriptor and shared guidance in %s mode", async (payloadMode) => {
    const onDispatch = vi.fn();
    guardedFetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      expect(onDispatch).toHaveBeenCalledOnce();
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.paperclipRuntimeTools).toEqual({
        version: 1,
        guidance: CONNECTION_INTENT_AGENT_GUIDANCE,
        mcpEndpoint: "https://paperclip.test/mcp/runtime-tools",
        rest: {
          connectionsSearch: "https://paperclip.test/runtime-tools/connections/search",
          connectionRequest: "https://paperclip.test/runtime-tools/connections/request",
        },
        bearerToken: "run-token",
        expiresAt: "2026-08-26T15:00:00.000Z",
        tools: ["connections_search", "connection_request"],
      });
      return new Response(null, { status: 204 });
    });

    await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Agent",
        adapterType: "http",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: { url: "https://example.test/webhook", payloadMode },
      context: {},
      runtimeTools: {
        version: 1,
        guidance: CONNECTION_INTENT_AGENT_GUIDANCE,
        mcpEndpoint: "https://paperclip.test/mcp/runtime-tools",
        rest: {
          connectionsSearch: "https://paperclip.test/runtime-tools/connections/search",
          connectionRequest: "https://paperclip.test/runtime-tools/connections/request",
        },
        bearerToken: "run-token",
        expiresAt: "2026-08-26T15:00:00.000Z",
        tools: ["connections_search", "connection_request"],
      },
      onLog: async () => {},
      onDispatch,
    });

    expect(guardedFetchMock).toHaveBeenCalledOnce();
    expect(onDispatch).toHaveBeenCalledOnce();
  });

  it("sends the server snapshot instead of a configured payload instruction block", async () => {
    const snapshot = { text: "Use the release handbook.", digest: "server-digest" };
    guardedFetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).connectionInstructions).toEqual(snapshot);
      return new Response(null, { status: 204 });
    });
    await execute({ runId: "run-1", agent: { id: "agent-1", companyId: "company-1", name: "Agent", adapterType: "http", adapterConfig: {} }, runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { url: "https://example.test/webhook", payloadTemplate: { connectionInstructions: { text: "forged" } } }, context: { connectionInstructions: snapshot }, onLog: async () => {},
    });
    expect(guardedFetchMock).toHaveBeenCalledOnce();
  });

  it("reports configured request timeout as timed_out", async () => {
    guardedFetchMock.mockImplementation(
      (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
    );

    const result = await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Agent",
        adapterType: "http",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        url: "https://example.test/webhook",
        timeoutMs: 1,
      },
      context: {},
      onLog: async () => {},
    });

    expect(result.timedOut).toBe(true);
    expect(result.errorCode).toBe("timeout");
    expect(result.errorMessage).toContain("timed out after 1ms");
  });
});

const callbackFixtureText = readFileSync(new URL("./fixtures/callback-v1.json", import.meta.url), "utf8");
const callbackFixture = JSON.parse(callbackFixtureText);

function callbackExecution(overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  return {
    runId: callbackFixture.runId,
    agent: { id: callbackFixture.agentId, companyId: "company-1", name: "Callback", adapterType: "http", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { url: "https://example.test/callback", payloadMode: "callback_v1", headers: { Authorization: "Bearer synthetic-ingress" } },
    context: { ...callbackFixture.context },
    onLog: async () => {},
    ...overrides,
  };
}

describe("http callback_v1 wire contract", () => {
  it("serializes the consumer fixture without top-level or nested runtime capabilities", async () => {
    const secret = "synthetic-runtime-secret-must-not-be-sent";
    const context = Object.freeze({
      ...callbackFixture.context,
      paperclipRuntimeTools: { bearerToken: secret },
      paperclipManagedMcp: { token: secret },
      connectionInstructions: { text: secret, digest: "snapshot-digest" },
      futureRuntimeCapability: { nested: { token: secret } },
    });
    const onDispatch = vi.fn();
    const runtimeTools: AdapterRuntimeToolAccess = {
      version: 1, guidance: secret, mcpEndpoint: "https://paperclip.test/mcp/runtime-tools",
      rest: { connectionsSearch: "https://paperclip.test/search", connectionRequest: "https://paperclip.test/request" },
      bearerToken: secret, expiresAt: "2099-01-01T00:00:00.000Z", tools: ["connections_search", "connection_request"],
    };
    guardedFetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const wire = String(init?.body);
      expect(init?.headers).toMatchObject({ Authorization: "Bearer synthetic-ingress" });
      expect(wire).not.toContain(secret);
      expect(JSON.stringify(JSON.parse(wire), null, 2) + "\n").toBe(callbackFixtureText);
      expect(onDispatch).toHaveBeenCalledOnce();
      return new Response(null, { status: 204 });
    });
    expect((await execute(callbackExecution({ context, runtimeTools, onDispatch }))).exitCode).toBe(0);
    expect(guardedFetchMock).toHaveBeenCalledOnce();
    expect(context.paperclipRuntimeTools.bearerToken).toBe(secret);
  });

  it.each(["issueId", "taskId"])("accepts the single %s task alias", async (field) => {
    guardedFetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await execute(callbackExecution({ context: { [field]: callbackFixture.context.issueId } }));
    expect(JSON.parse(String(guardedFetchMock.mock.calls[0][1].body)).context).toEqual({ [field]: callbackFixture.context.issueId });
  });

  it.each([
    {}, { issueId: "" }, { issueId: { token: "secret" } }, { taskId: 42 },
    { issueId: " padded " }, { issueId: "one", taskId: "another" },
  ])("rejects invalid task context before dispatch: %j", async (context) => {
    const onDispatch = vi.fn();
    await expect(execute(callbackExecution({ context, onDispatch }))).rejects.toThrow("HTTP callback_v1");
    expect(guardedFetchMock).not.toHaveBeenCalled();
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it.each(["callback_v2", "callback-v1", false, null])("rejects unknown mode %j without falling back to credential delivery", async (payloadMode) => {
    await expect(execute(callbackExecution({ config: { url: "https://example.test/callback", payloadMode } }))).rejects.toThrow("HTTP payloadMode");
    expect(guardedFetchMock).not.toHaveBeenCalled();
  });

  it.each([{ paperclipRuntimeTools: { bearerToken: "forged" } }, { context: { issueId: "forged" } }, [], "template", null])("rejects callback template injection: %j", async (payloadTemplate) => {
    await expect(execute(callbackExecution({ config: { url: "https://example.test/callback", payloadMode: "callback_v1", payloadTemplate } }))).rejects.toThrow("payloadTemplate");
    expect(guardedFetchMock).not.toHaveBeenCalled();
  });

  it("accepts an empty callback template and reports non-success responses as failures", async () => {
    guardedFetchMock.mockResolvedValue(new Response(null, { status: 409 }));
    await expect(execute(callbackExecution({ config: { url: "https://example.test/callback", payloadMode: "callback_v1", payloadTemplate: {} } }))).rejects.toThrow("HTTP invoke failed with status 409");
    expect(guardedFetchMock).toHaveBeenCalledOnce();
  });

  it("environment validation rejects unsafe configuration before a HEAD probe", async () => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "http", config: { url: "https://example.test/callback", payloadMode: "callback_v2" } });
    expect(result.status).toBe("fail");
    expect(result.checks[0].code).toBe("http_payload_config_invalid");
    expect(guardedFetchMock).not.toHaveBeenCalled();
  });
});
