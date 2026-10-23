import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";

export const httpAdapter: ServerAdapterModule = {
  type: "http",
  runtimeToolDelivery: "invocation_context",
  execute,
  testEnvironment,
  models: [],
  agentConfigurationDoc: `# http agent configuration

Adapter: http

Core fields:
- url (string, required): endpoint to invoke
- method (string, optional): HTTP method, default POST
- headers (object, optional): request headers
- payloadMode ("agent" | "callback_v1", optional): default agent; callback_v1 sends only agent/run/task IDs and no runtime capabilities
- payloadTemplate (object, optional): JSON payload template; callback_v1 accepts only an empty template
- timeoutSec (number, optional): request timeout in seconds
`,
};
