import {
  PollingA2AInvoker,
  createOfficialClientProvider,
} from "../src/a2a-invoker.js";
import { loadConfig } from "../src/config.js";
import { FileContextStore } from "../src/context-store.js";
import type { LettaModApi } from "../src/mod-api.js";
import { A2AModController } from "../src/mod-controller.js";
import { A2AToolService } from "../src/tool-service.js";

export default function activate(letta: LettaModApi) {
  if (!letta.capabilities.tools) return;

  let controller: A2AModController | undefined;
  let configurationError: string | undefined;
  try {
    const config = loadConfig();
    controller = new A2AModController(
      config,
      new A2AToolService(
        config.routes,
        new PollingA2AInvoker(createOfficialClientProvider(), config),
        new FileContextStore(config.contextStorePath),
      ),
    );
  } catch (error) {
    configurationError = error instanceof Error ? error.message : String(error);
    letta.diagnostics.report({
      message: `a2a_invoke unavailable: ${configurationError}`,
      severity: "error",
    });
  }

  const targets = controller?.targets().join(", ") ?? "none configured";
  return letta.tools.register({
    name: "a2a_invoke",
    description:
      `Call a configured remote A2A agent and return its final text result. ` +
      `Remote context is reused automatically for this Letta conversation and target. ` +
      `Configured targets: ${targets}.`,
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Configured A2A target name.",
        },
        message: {
          type: "string",
          description: "Complete task or question to send to the remote agent.",
        },
        context_id: {
          type: "string",
          description:
            "Optional explicit remote A2A context ID. Usually omit this and let the mod preserve continuity.",
        },
        new_context: {
          type: "boolean",
          description:
            "Start a fresh remote A2A context instead of continuing the saved one.",
        },
      },
      required: ["target", "message"],
      additionalProperties: false,
    },
    requiresApproval: false,
    parallelSafe: false,
    async run(context) {
      if (!controller) {
        return {
          status: "error",
          content: configurationError ?? "A2A client is not configured",
        };
      }
      return controller.run(context);
    },
  });
}
