---
title: HTTP Adapter
summary: HTTP webhook adapter
---

The `http` adapter sends a webhook request to an external agent service. The agent runs externally and Paperclip just triggers it.

## When to Use

- Agent runs as an external service (cloud function, dedicated server)
- Fire-and-forget invocation model
- Integration with third-party agent platforms

## When Not to Use

- If the agent runs locally on the same machine (use `process`, `claude_local`, or `codex_local`)
- If you need stdout capture and real-time run viewing

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | Webhook URL to POST to |
| `headers` | object | No | Additional HTTP headers |
| `timeoutMs` | number | No | Request timeout in milliseconds |
| `method` | string | No | HTTP method, default POST |
| `payloadMode` | string | No | Default `agent`; opt in to `callback_v1` for a task-bound data-only callback |
| `payloadTemplate` | object | No | Agent-mode additions; only an empty object is accepted in callback mode |

## How It Works

1. Paperclip sends a POST request to the configured URL
2. The request body includes the execution context (agent ID, task info, wake reason)
3. The external agent processes the request and calls back to the Paperclip API
4. Response from the webhook is captured as the run result

## Request Body

The default `agent` mode includes the execution context, the server instruction
snapshot and available runtime-tool descriptors. Existing HTTP agents retain
that behavior when `payloadMode` is absent or set to `agent`.

## Task-bound data-only callbacks

Set `adapterConfig.payloadMode` to `callback_v1` for an endpoint that must not
receive Paperclip-generated runtime-tool credentials or instructions:

```json
{
  "url": "https://callbacks.example.test/run",
  "payloadMode": "callback_v1",
  "timeoutMs": 60000,
  "headers": { "Authorization": "Bearer <callback-ingress-token>" }
}
```

The request contains exactly this versioned shape:

```json
{
  "agentId": "...",
  "runId": "...",
  "context": { "issueId": "...", "taskId": "..." },
  "connectionInstructions": null
}
```

Only task ID strings are copied into context. At least one of `issueId` or
`taskId` must exist. If both exist, they must match. All other context fields,
including nested runtime tools, managed MCP configuration, instructions and
future capabilities, are excluded by projection. The input context is not
modified. Runtime capabilities are also omitted from the top-level payload.
Configured request headers remain explicit operator input; this mode does not
remove those headers or change agent/API permissions.

Nonempty or non-object `payloadTemplate` values are rejected in callback mode.
Unknown modes and invalid task IDs fail before dispatch or network access;
there is no fallback to agent-mode credential delivery. Environment validation
checks mode/template configuration before its HEAD probe. URL validation,
DNS-pinning, private-endpoint allowlists, timeout handling and non-2xx failure
semantics remain in force.

The callback endpoint must have its own narrowly scoped API credential if it
needs to read or update Paperclip. It must preserve the native `runId` for
normal run attribution. A successful HTTP invocation alone does not prove the
endpoint performed its intended operation; verify its outcome receipt too.

The checked-in wire fixture at
`server/src/adapters/http/fixtures/callback-v1.json` is compared with the actual
serialized request in the adapter regression tests. It contains synthetic IDs
and no credential values, so external consumers can test against that contract.
