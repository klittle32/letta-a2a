// src/a2a-invoker.ts
import { setTimeout as sleep } from "node:timers/promises";

// node_modules/@a2a-js/sdk/dist/index.js
var TaskState = /* @__PURE__ */ ((TaskState2) => {
  TaskState2[TaskState2["TASK_STATE_UNSPECIFIED"] = 0] = "TASK_STATE_UNSPECIFIED";
  TaskState2[TaskState2["TASK_STATE_SUBMITTED"] = 1] = "TASK_STATE_SUBMITTED";
  TaskState2[TaskState2["TASK_STATE_WORKING"] = 2] = "TASK_STATE_WORKING";
  TaskState2[TaskState2["TASK_STATE_COMPLETED"] = 3] = "TASK_STATE_COMPLETED";
  TaskState2[TaskState2["TASK_STATE_FAILED"] = 4] = "TASK_STATE_FAILED";
  TaskState2[TaskState2["TASK_STATE_CANCELED"] = 5] = "TASK_STATE_CANCELED";
  TaskState2[TaskState2["TASK_STATE_INPUT_REQUIRED"] = 6] = "TASK_STATE_INPUT_REQUIRED";
  TaskState2[TaskState2["TASK_STATE_REJECTED"] = 7] = "TASK_STATE_REJECTED";
  TaskState2[TaskState2["TASK_STATE_AUTH_REQUIRED"] = 8] = "TASK_STATE_AUTH_REQUIRED";
  TaskState2[TaskState2["UNRECOGNIZED"] = -1] = "UNRECOGNIZED";
  return TaskState2;
})(TaskState || {});
var Role = /* @__PURE__ */ ((Role2) => {
  Role2[Role2["ROLE_UNSPECIFIED"] = 0] = "ROLE_UNSPECIFIED";
  Role2[Role2["ROLE_USER"] = 1] = "ROLE_USER";
  Role2[Role2["ROLE_AGENT"] = 2] = "ROLE_AGENT";
  Role2[Role2["UNRECOGNIZED"] = -1] = "UNRECOGNIZED";
  return Role2;
})(Role || {});
var DEFAULT_MAX_SSE_EVENT_SIZE_BYTES = 4 * 1024 * 1024;

// node_modules/@a2a-js/sdk/dist/client/index.js
var AGENT_CARD_PATH = ".well-known/agent-card.json";
var HTTP_EXTENSION_HEADER = "A2A-Extensions";
var A2A_VERSION_HEADER = "A2A-Version";
var A2A_PROTOCOL_VERSION = "1.0";
var A2A_LEGACY_PROTOCOL_VERSION = "0.3";
var JSON_CONTENT_TYPE = "application/json";
var A2A_CONTENT_TYPE = "application/a2a+json";
function taskStateFromJSON(object) {
  switch (object) {
    case 0:
    case "TASK_STATE_UNSPECIFIED":
      return 0;
    case 1:
    case "TASK_STATE_SUBMITTED":
      return 1;
    case 2:
    case "TASK_STATE_WORKING":
      return 2;
    case 3:
    case "TASK_STATE_COMPLETED":
      return 3;
    case 4:
    case "TASK_STATE_FAILED":
      return 4;
    case 5:
    case "TASK_STATE_CANCELED":
      return 5;
    case 6:
    case "TASK_STATE_INPUT_REQUIRED":
      return 6;
    case 7:
    case "TASK_STATE_REJECTED":
      return 7;
    case 8:
    case "TASK_STATE_AUTH_REQUIRED":
      return 8;
    case -1:
    case "UNRECOGNIZED":
    default:
      return -1;
  }
}
function taskStateToJSON(object) {
  switch (object) {
    case 0:
      return "TASK_STATE_UNSPECIFIED";
    case 1:
      return "TASK_STATE_SUBMITTED";
    case 2:
      return "TASK_STATE_WORKING";
    case 3:
      return "TASK_STATE_COMPLETED";
    case 4:
      return "TASK_STATE_FAILED";
    case 5:
      return "TASK_STATE_CANCELED";
    case 6:
      return "TASK_STATE_INPUT_REQUIRED";
    case 7:
      return "TASK_STATE_REJECTED";
    case 8:
      return "TASK_STATE_AUTH_REQUIRED";
    case -1:
    default:
      return "UNRECOGNIZED";
  }
}
function roleFromJSON(object) {
  switch (object) {
    case 0:
    case "ROLE_UNSPECIFIED":
      return 0;
    case 1:
    case "ROLE_USER":
      return 1;
    case 2:
    case "ROLE_AGENT":
      return 2;
    case -1:
    case "UNRECOGNIZED":
    default:
      return -1;
  }
}
function roleToJSON(object) {
  switch (object) {
    case 0:
      return "ROLE_UNSPECIFIED";
    case 1:
      return "ROLE_USER";
    case 2:
      return "ROLE_AGENT";
    case -1:
    default:
      return "UNRECOGNIZED";
  }
}
var SendMessageConfiguration = {
  fromJSON(object) {
    return {
      acceptedOutputModes: globalThis.Array.isArray(object?.acceptedOutputModes) ? object.acceptedOutputModes.map((e) => globalThis.String(e)) : globalThis.Array.isArray(object?.accepted_output_modes) ? object.accepted_output_modes.map((e) => globalThis.String(e)) : [],
      taskPushNotificationConfig: isSet(object.taskPushNotificationConfig) ? TaskPushNotificationConfig.fromJSON(object.taskPushNotificationConfig) : isSet(object.task_push_notification_config) ? TaskPushNotificationConfig.fromJSON(object.task_push_notification_config) : undefined,
      historyLength: isSet(object.historyLength) ? globalThis.Number(object.historyLength) : isSet(object.history_length) ? globalThis.Number(object.history_length) : undefined,
      returnImmediately: isSet(object.returnImmediately) ? globalThis.Boolean(object.returnImmediately) : isSet(object.return_immediately) ? globalThis.Boolean(object.return_immediately) : false
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.acceptedOutputModes?.length) {
      obj.acceptedOutputModes = message.acceptedOutputModes;
    }
    if (message.taskPushNotificationConfig !== undefined) {
      obj.taskPushNotificationConfig = TaskPushNotificationConfig.toJSON(message.taskPushNotificationConfig);
    }
    if (message.historyLength !== undefined) {
      obj.historyLength = Math.round(message.historyLength);
    }
    if (message.returnImmediately !== false) {
      obj.returnImmediately = message.returnImmediately;
    }
    return obj;
  }
};
var Task = {
  fromJSON(object) {
    return {
      id: isSet(object.id) ? globalThis.String(object.id) : "",
      contextId: isSet(object.contextId) ? globalThis.String(object.contextId) : isSet(object.context_id) ? globalThis.String(object.context_id) : "",
      status: isSet(object.status) ? TaskStatus.fromJSON(object.status) : undefined,
      artifacts: globalThis.Array.isArray(object?.artifacts) ? object.artifacts.map((e) => Artifact.fromJSON(e)) : [],
      history: globalThis.Array.isArray(object?.history) ? object.history.map((e) => Message.fromJSON(e)) : [],
      metadata: isObject(object.metadata) ? object.metadata : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.status !== undefined) {
      obj.status = TaskStatus.toJSON(message.status);
    }
    if (message.artifacts?.length) {
      obj.artifacts = message.artifacts.map((e) => Artifact.toJSON(e));
    }
    if (message.history?.length) {
      obj.history = message.history.map((e) => Message.toJSON(e));
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  }
};
var TaskStatus = {
  fromJSON(object) {
    return {
      state: isSet(object.state) ? taskStateFromJSON(object.state) : 0,
      message: isSet(object.message) ? Message.fromJSON(object.message) : undefined,
      timestamp: isSet(object.timestamp) ? globalThis.String(object.timestamp) : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.state !== 0) {
      obj.state = taskStateToJSON(message.state);
    }
    if (message.message !== undefined) {
      obj.message = Message.toJSON(message.message);
    }
    if (message.timestamp !== undefined) {
      obj.timestamp = message.timestamp;
    }
    return obj;
  }
};
var Part = {
  fromJSON(object) {
    return {
      content: isSet(object.text) ? { $case: "text", value: globalThis.String(object.text) } : isSet(object.raw) ? { $case: "raw", value: Buffer.from(bytesFromBase64(object.raw)) } : isSet(object.url) ? { $case: "url", value: globalThis.String(object.url) } : isSet(object.data) ? { $case: "data", value: object.data } : undefined,
      metadata: isObject(object.metadata) ? object.metadata : undefined,
      filename: isSet(object.filename) ? globalThis.String(object.filename) : "",
      mediaType: isSet(object.mediaType) ? globalThis.String(object.mediaType) : isSet(object.media_type) ? globalThis.String(object.media_type) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.content?.$case === "text") {
      obj.text = message.content.value;
    } else if (message.content?.$case === "raw") {
      obj.raw = base64FromBytes(message.content.value);
    } else if (message.content?.$case === "url") {
      obj.url = message.content.value;
    } else if (message.content?.$case === "data") {
      obj.data = message.content.value;
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    if (message.filename !== "") {
      obj.filename = message.filename;
    }
    if (message.mediaType !== "") {
      obj.mediaType = message.mediaType;
    }
    return obj;
  }
};
var Message = {
  fromJSON(object) {
    return {
      messageId: isSet(object.messageId) ? globalThis.String(object.messageId) : isSet(object.message_id) ? globalThis.String(object.message_id) : "",
      contextId: isSet(object.contextId) ? globalThis.String(object.contextId) : isSet(object.context_id) ? globalThis.String(object.context_id) : "",
      taskId: isSet(object.taskId) ? globalThis.String(object.taskId) : isSet(object.task_id) ? globalThis.String(object.task_id) : "",
      role: isSet(object.role) ? roleFromJSON(object.role) : 0,
      parts: globalThis.Array.isArray(object?.parts) ? object.parts.map((e) => Part.fromJSON(e)) : [],
      metadata: isObject(object.metadata) ? object.metadata : undefined,
      extensions: globalThis.Array.isArray(object?.extensions) ? object.extensions.map((e) => globalThis.String(e)) : [],
      referenceTaskIds: globalThis.Array.isArray(object?.referenceTaskIds) ? object.referenceTaskIds.map((e) => globalThis.String(e)) : globalThis.Array.isArray(object?.reference_task_ids) ? object.reference_task_ids.map((e) => globalThis.String(e)) : []
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.messageId !== "") {
      obj.messageId = message.messageId;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.role !== 0) {
      obj.role = roleToJSON(message.role);
    }
    if (message.parts?.length) {
      obj.parts = message.parts.map((e) => Part.toJSON(e));
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    if (message.extensions?.length) {
      obj.extensions = message.extensions;
    }
    if (message.referenceTaskIds?.length) {
      obj.referenceTaskIds = message.referenceTaskIds;
    }
    return obj;
  }
};
var Artifact = {
  fromJSON(object) {
    return {
      artifactId: isSet(object.artifactId) ? globalThis.String(object.artifactId) : isSet(object.artifact_id) ? globalThis.String(object.artifact_id) : "",
      name: isSet(object.name) ? globalThis.String(object.name) : "",
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      parts: globalThis.Array.isArray(object?.parts) ? object.parts.map((e) => Part.fromJSON(e)) : [],
      metadata: isObject(object.metadata) ? object.metadata : undefined,
      extensions: globalThis.Array.isArray(object?.extensions) ? object.extensions.map((e) => globalThis.String(e)) : []
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.artifactId !== "") {
      obj.artifactId = message.artifactId;
    }
    if (message.name !== "") {
      obj.name = message.name;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.parts?.length) {
      obj.parts = message.parts.map((e) => Part.toJSON(e));
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    if (message.extensions?.length) {
      obj.extensions = message.extensions;
    }
    return obj;
  }
};
var TaskStatusUpdateEvent = {
  fromJSON(object) {
    return {
      taskId: isSet(object.taskId) ? globalThis.String(object.taskId) : isSet(object.task_id) ? globalThis.String(object.task_id) : "",
      contextId: isSet(object.contextId) ? globalThis.String(object.contextId) : isSet(object.context_id) ? globalThis.String(object.context_id) : "",
      status: isSet(object.status) ? TaskStatus.fromJSON(object.status) : undefined,
      metadata: isObject(object.metadata) ? object.metadata : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.status !== undefined) {
      obj.status = TaskStatus.toJSON(message.status);
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  }
};
var TaskArtifactUpdateEvent = {
  fromJSON(object) {
    return {
      taskId: isSet(object.taskId) ? globalThis.String(object.taskId) : isSet(object.task_id) ? globalThis.String(object.task_id) : "",
      contextId: isSet(object.contextId) ? globalThis.String(object.contextId) : isSet(object.context_id) ? globalThis.String(object.context_id) : "",
      artifact: isSet(object.artifact) ? Artifact.fromJSON(object.artifact) : undefined,
      append: isSet(object.append) ? globalThis.Boolean(object.append) : false,
      lastChunk: isSet(object.lastChunk) ? globalThis.Boolean(object.lastChunk) : isSet(object.last_chunk) ? globalThis.Boolean(object.last_chunk) : false,
      metadata: isObject(object.metadata) ? object.metadata : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.artifact !== undefined) {
      obj.artifact = Artifact.toJSON(message.artifact);
    }
    if (message.append !== false) {
      obj.append = message.append;
    }
    if (message.lastChunk !== false) {
      obj.lastChunk = message.lastChunk;
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  }
};
var AuthenticationInfo = {
  fromJSON(object) {
    return {
      scheme: isSet(object.scheme) ? globalThis.String(object.scheme) : "",
      credentials: isSet(object.credentials) ? globalThis.String(object.credentials) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.scheme !== "") {
      obj.scheme = message.scheme;
    }
    if (message.credentials !== "") {
      obj.credentials = message.credentials;
    }
    return obj;
  }
};
var AgentInterface = {
  fromJSON(object) {
    return {
      url: isSet(object.url) ? globalThis.String(object.url) : "",
      protocolBinding: isSet(object.protocolBinding) ? globalThis.String(object.protocolBinding) : isSet(object.protocol_binding) ? globalThis.String(object.protocol_binding) : "",
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      protocolVersion: isSet(object.protocolVersion) ? globalThis.String(object.protocolVersion) : isSet(object.protocol_version) ? globalThis.String(object.protocol_version) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.url !== "") {
      obj.url = message.url;
    }
    if (message.protocolBinding !== "") {
      obj.protocolBinding = message.protocolBinding;
    }
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.protocolVersion !== "") {
      obj.protocolVersion = message.protocolVersion;
    }
    return obj;
  }
};
var AgentCard = {
  fromJSON(object) {
    return {
      name: isSet(object.name) ? globalThis.String(object.name) : "",
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      supportedInterfaces: globalThis.Array.isArray(object?.supportedInterfaces) ? object.supportedInterfaces.map((e) => AgentInterface.fromJSON(e)) : globalThis.Array.isArray(object?.supported_interfaces) ? object.supported_interfaces.map((e) => AgentInterface.fromJSON(e)) : [],
      provider: isSet(object.provider) ? AgentProvider.fromJSON(object.provider) : undefined,
      version: isSet(object.version) ? globalThis.String(object.version) : "",
      documentationUrl: isSet(object.documentationUrl) ? globalThis.String(object.documentationUrl) : isSet(object.documentation_url) ? globalThis.String(object.documentation_url) : undefined,
      capabilities: isSet(object.capabilities) ? AgentCapabilities.fromJSON(object.capabilities) : undefined,
      securitySchemes: isObject(object.securitySchemes) ? globalThis.Object.entries(object.securitySchemes).reduce((acc, [key, value]) => {
        acc[key] = SecurityScheme.fromJSON(value);
        return acc;
      }, {}) : isObject(object.security_schemes) ? globalThis.Object.entries(object.security_schemes).reduce((acc, [key, value]) => {
        acc[key] = SecurityScheme.fromJSON(value);
        return acc;
      }, {}) : {},
      securityRequirements: globalThis.Array.isArray(object?.securityRequirements) ? object.securityRequirements.map((e) => SecurityRequirement.fromJSON(e)) : globalThis.Array.isArray(object?.security_requirements) ? object.security_requirements.map((e) => SecurityRequirement.fromJSON(e)) : [],
      defaultInputModes: globalThis.Array.isArray(object?.defaultInputModes) ? object.defaultInputModes.map((e) => globalThis.String(e)) : globalThis.Array.isArray(object?.default_input_modes) ? object.default_input_modes.map((e) => globalThis.String(e)) : [],
      defaultOutputModes: globalThis.Array.isArray(object?.defaultOutputModes) ? object.defaultOutputModes.map((e) => globalThis.String(e)) : globalThis.Array.isArray(object?.default_output_modes) ? object.default_output_modes.map((e) => globalThis.String(e)) : [],
      skills: globalThis.Array.isArray(object?.skills) ? object.skills.map((e) => AgentSkill.fromJSON(e)) : [],
      signatures: globalThis.Array.isArray(object?.signatures) ? object.signatures.map((e) => AgentCardSignature.fromJSON(e)) : [],
      iconUrl: isSet(object.iconUrl) ? globalThis.String(object.iconUrl) : isSet(object.icon_url) ? globalThis.String(object.icon_url) : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.name !== "") {
      obj.name = message.name;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.supportedInterfaces?.length) {
      obj.supportedInterfaces = message.supportedInterfaces.map((e) => AgentInterface.toJSON(e));
    }
    if (message.provider !== undefined) {
      obj.provider = AgentProvider.toJSON(message.provider);
    }
    if (message.version !== "") {
      obj.version = message.version;
    }
    if (message.documentationUrl !== undefined) {
      obj.documentationUrl = message.documentationUrl;
    }
    if (message.capabilities !== undefined) {
      obj.capabilities = AgentCapabilities.toJSON(message.capabilities);
    }
    if (message.securitySchemes) {
      const entries = globalThis.Object.entries(message.securitySchemes);
      if (entries.length > 0) {
        obj.securitySchemes = {};
        entries.forEach(([k, v]) => {
          obj.securitySchemes[k] = SecurityScheme.toJSON(v);
        });
      }
    }
    if (message.securityRequirements?.length) {
      obj.securityRequirements = message.securityRequirements.map((e) => SecurityRequirement.toJSON(e));
    }
    if (message.defaultInputModes?.length) {
      obj.defaultInputModes = message.defaultInputModes;
    }
    if (message.defaultOutputModes?.length) {
      obj.defaultOutputModes = message.defaultOutputModes;
    }
    if (message.skills?.length) {
      obj.skills = message.skills.map((e) => AgentSkill.toJSON(e));
    }
    if (message.signatures?.length) {
      obj.signatures = message.signatures.map((e) => AgentCardSignature.toJSON(e));
    }
    if (message.iconUrl !== undefined) {
      obj.iconUrl = message.iconUrl;
    }
    return obj;
  }
};
var AgentProvider = {
  fromJSON(object) {
    return {
      url: isSet(object.url) ? globalThis.String(object.url) : "",
      organization: isSet(object.organization) ? globalThis.String(object.organization) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.url !== "") {
      obj.url = message.url;
    }
    if (message.organization !== "") {
      obj.organization = message.organization;
    }
    return obj;
  }
};
var AgentCapabilities = {
  fromJSON(object) {
    return {
      streaming: isSet(object.streaming) ? globalThis.Boolean(object.streaming) : undefined,
      pushNotifications: isSet(object.pushNotifications) ? globalThis.Boolean(object.pushNotifications) : isSet(object.push_notifications) ? globalThis.Boolean(object.push_notifications) : undefined,
      extensions: globalThis.Array.isArray(object?.extensions) ? object.extensions.map((e) => AgentExtension.fromJSON(e)) : [],
      extendedAgentCard: isSet(object.extendedAgentCard) ? globalThis.Boolean(object.extendedAgentCard) : isSet(object.extended_agent_card) ? globalThis.Boolean(object.extended_agent_card) : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.streaming !== undefined) {
      obj.streaming = message.streaming;
    }
    if (message.pushNotifications !== undefined) {
      obj.pushNotifications = message.pushNotifications;
    }
    if (message.extensions?.length) {
      obj.extensions = message.extensions.map((e) => AgentExtension.toJSON(e));
    }
    if (message.extendedAgentCard !== undefined) {
      obj.extendedAgentCard = message.extendedAgentCard;
    }
    return obj;
  }
};
var AgentExtension = {
  fromJSON(object) {
    return {
      uri: isSet(object.uri) ? globalThis.String(object.uri) : "",
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      required: isSet(object.required) ? globalThis.Boolean(object.required) : false,
      params: isObject(object.params) ? object.params : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.uri !== "") {
      obj.uri = message.uri;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.required !== false) {
      obj.required = message.required;
    }
    if (message.params !== undefined) {
      obj.params = message.params;
    }
    return obj;
  }
};
var AgentSkill = {
  fromJSON(object) {
    return {
      id: isSet(object.id) ? globalThis.String(object.id) : "",
      name: isSet(object.name) ? globalThis.String(object.name) : "",
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      tags: globalThis.Array.isArray(object?.tags) ? object.tags.map((e) => globalThis.String(e)) : [],
      examples: globalThis.Array.isArray(object?.examples) ? object.examples.map((e) => globalThis.String(e)) : [],
      inputModes: globalThis.Array.isArray(object?.inputModes) ? object.inputModes.map((e) => globalThis.String(e)) : globalThis.Array.isArray(object?.input_modes) ? object.input_modes.map((e) => globalThis.String(e)) : [],
      outputModes: globalThis.Array.isArray(object?.outputModes) ? object.outputModes.map((e) => globalThis.String(e)) : globalThis.Array.isArray(object?.output_modes) ? object.output_modes.map((e) => globalThis.String(e)) : [],
      securityRequirements: globalThis.Array.isArray(object?.securityRequirements) ? object.securityRequirements.map((e) => SecurityRequirement.fromJSON(e)) : globalThis.Array.isArray(object?.security_requirements) ? object.security_requirements.map((e) => SecurityRequirement.fromJSON(e)) : []
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.name !== "") {
      obj.name = message.name;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.tags?.length) {
      obj.tags = message.tags;
    }
    if (message.examples?.length) {
      obj.examples = message.examples;
    }
    if (message.inputModes?.length) {
      obj.inputModes = message.inputModes;
    }
    if (message.outputModes?.length) {
      obj.outputModes = message.outputModes;
    }
    if (message.securityRequirements?.length) {
      obj.securityRequirements = message.securityRequirements.map((e) => SecurityRequirement.toJSON(e));
    }
    return obj;
  }
};
var AgentCardSignature = {
  fromJSON(object) {
    return {
      protected: isSet(object.protected) ? globalThis.String(object.protected) : "",
      signature: isSet(object.signature) ? globalThis.String(object.signature) : "",
      header: isObject(object.header) ? object.header : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.protected !== "") {
      obj.protected = message.protected;
    }
    if (message.signature !== "") {
      obj.signature = message.signature;
    }
    if (message.header !== undefined) {
      obj.header = message.header;
    }
    return obj;
  }
};
var TaskPushNotificationConfig = {
  fromJSON(object) {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      id: isSet(object.id) ? globalThis.String(object.id) : "",
      taskId: isSet(object.taskId) ? globalThis.String(object.taskId) : isSet(object.task_id) ? globalThis.String(object.task_id) : "",
      url: isSet(object.url) ? globalThis.String(object.url) : "",
      token: isSet(object.token) ? globalThis.String(object.token) : "",
      authentication: isSet(object.authentication) ? AuthenticationInfo.fromJSON(object.authentication) : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.url !== "") {
      obj.url = message.url;
    }
    if (message.token !== "") {
      obj.token = message.token;
    }
    if (message.authentication !== undefined) {
      obj.authentication = AuthenticationInfo.toJSON(message.authentication);
    }
    return obj;
  }
};
var StringList = {
  fromJSON(object) {
    return { list: globalThis.Array.isArray(object?.list) ? object.list.map((e) => globalThis.String(e)) : [] };
  },
  toJSON(message) {
    const obj = {};
    if (message.list?.length) {
      obj.list = message.list;
    }
    return obj;
  }
};
var SecurityRequirement = {
  fromJSON(object) {
    return {
      schemes: isObject(object.schemes) ? globalThis.Object.entries(object.schemes).reduce((acc, [key, value]) => {
        acc[key] = StringList.fromJSON(value);
        return acc;
      }, {}) : {}
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.schemes) {
      const entries = globalThis.Object.entries(message.schemes);
      if (entries.length > 0) {
        obj.schemes = {};
        entries.forEach(([k, v]) => {
          obj.schemes[k] = StringList.toJSON(v);
        });
      }
    }
    return obj;
  }
};
var SecurityScheme = {
  fromJSON(object) {
    return {
      scheme: isSet(object.apiKeySecurityScheme) ? { $case: "apiKeySecurityScheme", value: APIKeySecurityScheme.fromJSON(object.apiKeySecurityScheme) } : isSet(object.api_key_security_scheme) ? { $case: "apiKeySecurityScheme", value: APIKeySecurityScheme.fromJSON(object.api_key_security_scheme) } : isSet(object.httpAuthSecurityScheme) ? { $case: "httpAuthSecurityScheme", value: HTTPAuthSecurityScheme.fromJSON(object.httpAuthSecurityScheme) } : isSet(object.http_auth_security_scheme) ? { $case: "httpAuthSecurityScheme", value: HTTPAuthSecurityScheme.fromJSON(object.http_auth_security_scheme) } : isSet(object.oauth2SecurityScheme) ? { $case: "oauth2SecurityScheme", value: OAuth2SecurityScheme.fromJSON(object.oauth2SecurityScheme) } : isSet(object.oauth2_security_scheme) ? { $case: "oauth2SecurityScheme", value: OAuth2SecurityScheme.fromJSON(object.oauth2_security_scheme) } : isSet(object.openIdConnectSecurityScheme) ? {
        $case: "openIdConnectSecurityScheme",
        value: OpenIdConnectSecurityScheme.fromJSON(object.openIdConnectSecurityScheme)
      } : isSet(object.open_id_connect_security_scheme) ? {
        $case: "openIdConnectSecurityScheme",
        value: OpenIdConnectSecurityScheme.fromJSON(object.open_id_connect_security_scheme)
      } : isSet(object.mtlsSecurityScheme) ? { $case: "mtlsSecurityScheme", value: MutualTlsSecurityScheme.fromJSON(object.mtlsSecurityScheme) } : isSet(object.mtls_security_scheme) ? { $case: "mtlsSecurityScheme", value: MutualTlsSecurityScheme.fromJSON(object.mtls_security_scheme) } : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.scheme?.$case === "apiKeySecurityScheme") {
      obj.apiKeySecurityScheme = APIKeySecurityScheme.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "httpAuthSecurityScheme") {
      obj.httpAuthSecurityScheme = HTTPAuthSecurityScheme.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "oauth2SecurityScheme") {
      obj.oauth2SecurityScheme = OAuth2SecurityScheme.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "openIdConnectSecurityScheme") {
      obj.openIdConnectSecurityScheme = OpenIdConnectSecurityScheme.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "mtlsSecurityScheme") {
      obj.mtlsSecurityScheme = MutualTlsSecurityScheme.toJSON(message.scheme.value);
    }
    return obj;
  }
};
var APIKeySecurityScheme = {
  fromJSON(object) {
    return {
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      location: isSet(object.location) ? globalThis.String(object.location) : "",
      name: isSet(object.name) ? globalThis.String(object.name) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.location !== "") {
      obj.location = message.location;
    }
    if (message.name !== "") {
      obj.name = message.name;
    }
    return obj;
  }
};
var HTTPAuthSecurityScheme = {
  fromJSON(object) {
    return {
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      scheme: isSet(object.scheme) ? globalThis.String(object.scheme) : "",
      bearerFormat: isSet(object.bearerFormat) ? globalThis.String(object.bearerFormat) : isSet(object.bearer_format) ? globalThis.String(object.bearer_format) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.scheme !== "") {
      obj.scheme = message.scheme;
    }
    if (message.bearerFormat !== "") {
      obj.bearerFormat = message.bearerFormat;
    }
    return obj;
  }
};
var OAuth2SecurityScheme = {
  fromJSON(object) {
    return {
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      flows: isSet(object.flows) ? OAuthFlows.fromJSON(object.flows) : undefined,
      oauth2MetadataUrl: isSet(object.oauth2MetadataUrl) ? globalThis.String(object.oauth2MetadataUrl) : isSet(object.oauth2_metadata_url) ? globalThis.String(object.oauth2_metadata_url) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.flows !== undefined) {
      obj.flows = OAuthFlows.toJSON(message.flows);
    }
    if (message.oauth2MetadataUrl !== "") {
      obj.oauth2MetadataUrl = message.oauth2MetadataUrl;
    }
    return obj;
  }
};
var OpenIdConnectSecurityScheme = {
  fromJSON(object) {
    return {
      description: isSet(object.description) ? globalThis.String(object.description) : "",
      openIdConnectUrl: isSet(object.openIdConnectUrl) ? globalThis.String(object.openIdConnectUrl) : isSet(object.open_id_connect_url) ? globalThis.String(object.open_id_connect_url) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.openIdConnectUrl !== "") {
      obj.openIdConnectUrl = message.openIdConnectUrl;
    }
    return obj;
  }
};
var MutualTlsSecurityScheme = {
  fromJSON(object) {
    return { description: isSet(object.description) ? globalThis.String(object.description) : "" };
  },
  toJSON(message) {
    const obj = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    return obj;
  }
};
var OAuthFlows = {
  fromJSON(object) {
    return {
      flow: isSet(object.authorizationCode) ? { $case: "authorizationCode", value: AuthorizationCodeOAuthFlow.fromJSON(object.authorizationCode) } : isSet(object.authorization_code) ? { $case: "authorizationCode", value: AuthorizationCodeOAuthFlow.fromJSON(object.authorization_code) } : isSet(object.clientCredentials) ? { $case: "clientCredentials", value: ClientCredentialsOAuthFlow.fromJSON(object.clientCredentials) } : isSet(object.client_credentials) ? { $case: "clientCredentials", value: ClientCredentialsOAuthFlow.fromJSON(object.client_credentials) } : isSet(object.implicit) ? { $case: "implicit", value: ImplicitOAuthFlow.fromJSON(object.implicit) } : isSet(object.password) ? { $case: "password", value: PasswordOAuthFlow.fromJSON(object.password) } : isSet(object.deviceCode) ? { $case: "deviceCode", value: DeviceCodeOAuthFlow.fromJSON(object.deviceCode) } : isSet(object.device_code) ? { $case: "deviceCode", value: DeviceCodeOAuthFlow.fromJSON(object.device_code) } : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.flow?.$case === "authorizationCode") {
      obj.authorizationCode = AuthorizationCodeOAuthFlow.toJSON(message.flow.value);
    } else if (message.flow?.$case === "clientCredentials") {
      obj.clientCredentials = ClientCredentialsOAuthFlow.toJSON(message.flow.value);
    } else if (message.flow?.$case === "implicit") {
      obj.implicit = ImplicitOAuthFlow.toJSON(message.flow.value);
    } else if (message.flow?.$case === "password") {
      obj.password = PasswordOAuthFlow.toJSON(message.flow.value);
    } else if (message.flow?.$case === "deviceCode") {
      obj.deviceCode = DeviceCodeOAuthFlow.toJSON(message.flow.value);
    }
    return obj;
  }
};
var AuthorizationCodeOAuthFlow = {
  fromJSON(object) {
    return {
      authorizationUrl: isSet(object.authorizationUrl) ? globalThis.String(object.authorizationUrl) : isSet(object.authorization_url) ? globalThis.String(object.authorization_url) : "",
      tokenUrl: isSet(object.tokenUrl) ? globalThis.String(object.tokenUrl) : isSet(object.token_url) ? globalThis.String(object.token_url) : "",
      refreshUrl: isSet(object.refreshUrl) ? globalThis.String(object.refreshUrl) : isSet(object.refresh_url) ? globalThis.String(object.refresh_url) : "",
      scopes: isObject(object.scopes) ? globalThis.Object.entries(object.scopes).reduce((acc, [key, value]) => {
        acc[key] = globalThis.String(value);
        return acc;
      }, {}) : {},
      pkceRequired: isSet(object.pkceRequired) ? globalThis.Boolean(object.pkceRequired) : isSet(object.pkce_required) ? globalThis.Boolean(object.pkce_required) : false
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.authorizationUrl !== "") {
      obj.authorizationUrl = message.authorizationUrl;
    }
    if (message.tokenUrl !== "") {
      obj.tokenUrl = message.tokenUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes);
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    if (message.pkceRequired !== false) {
      obj.pkceRequired = message.pkceRequired;
    }
    return obj;
  }
};
var ClientCredentialsOAuthFlow = {
  fromJSON(object) {
    return {
      tokenUrl: isSet(object.tokenUrl) ? globalThis.String(object.tokenUrl) : isSet(object.token_url) ? globalThis.String(object.token_url) : "",
      refreshUrl: isSet(object.refreshUrl) ? globalThis.String(object.refreshUrl) : isSet(object.refresh_url) ? globalThis.String(object.refresh_url) : "",
      scopes: isObject(object.scopes) ? globalThis.Object.entries(object.scopes).reduce((acc, [key, value]) => {
        acc[key] = globalThis.String(value);
        return acc;
      }, {}) : {}
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tokenUrl !== "") {
      obj.tokenUrl = message.tokenUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes);
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  }
};
var ImplicitOAuthFlow = {
  fromJSON(object) {
    return {
      authorizationUrl: isSet(object.authorizationUrl) ? globalThis.String(object.authorizationUrl) : isSet(object.authorization_url) ? globalThis.String(object.authorization_url) : "",
      refreshUrl: isSet(object.refreshUrl) ? globalThis.String(object.refreshUrl) : isSet(object.refresh_url) ? globalThis.String(object.refresh_url) : "",
      scopes: isObject(object.scopes) ? globalThis.Object.entries(object.scopes).reduce((acc, [key, value]) => {
        acc[key] = globalThis.String(value);
        return acc;
      }, {}) : {}
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.authorizationUrl !== "") {
      obj.authorizationUrl = message.authorizationUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes);
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  }
};
var PasswordOAuthFlow = {
  fromJSON(object) {
    return {
      tokenUrl: isSet(object.tokenUrl) ? globalThis.String(object.tokenUrl) : isSet(object.token_url) ? globalThis.String(object.token_url) : "",
      refreshUrl: isSet(object.refreshUrl) ? globalThis.String(object.refreshUrl) : isSet(object.refresh_url) ? globalThis.String(object.refresh_url) : "",
      scopes: isObject(object.scopes) ? globalThis.Object.entries(object.scopes).reduce((acc, [key, value]) => {
        acc[key] = globalThis.String(value);
        return acc;
      }, {}) : {}
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tokenUrl !== "") {
      obj.tokenUrl = message.tokenUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes);
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  }
};
var DeviceCodeOAuthFlow = {
  fromJSON(object) {
    return {
      deviceAuthorizationUrl: isSet(object.deviceAuthorizationUrl) ? globalThis.String(object.deviceAuthorizationUrl) : isSet(object.device_authorization_url) ? globalThis.String(object.device_authorization_url) : "",
      tokenUrl: isSet(object.tokenUrl) ? globalThis.String(object.tokenUrl) : isSet(object.token_url) ? globalThis.String(object.token_url) : "",
      refreshUrl: isSet(object.refreshUrl) ? globalThis.String(object.refreshUrl) : isSet(object.refresh_url) ? globalThis.String(object.refresh_url) : "",
      scopes: isObject(object.scopes) ? globalThis.Object.entries(object.scopes).reduce((acc, [key, value]) => {
        acc[key] = globalThis.String(value);
        return acc;
      }, {}) : {}
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.deviceAuthorizationUrl !== "") {
      obj.deviceAuthorizationUrl = message.deviceAuthorizationUrl;
    }
    if (message.tokenUrl !== "") {
      obj.tokenUrl = message.tokenUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes);
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  }
};
var SendMessageRequest = {
  fromJSON(object) {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      message: isSet(object.message) ? Message.fromJSON(object.message) : undefined,
      configuration: isSet(object.configuration) ? SendMessageConfiguration.fromJSON(object.configuration) : undefined,
      metadata: isObject(object.metadata) ? object.metadata : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.message !== undefined) {
      obj.message = Message.toJSON(message.message);
    }
    if (message.configuration !== undefined) {
      obj.configuration = SendMessageConfiguration.toJSON(message.configuration);
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  }
};
var GetTaskRequest = {
  fromJSON(object) {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      id: isSet(object.id) ? globalThis.String(object.id) : "",
      historyLength: isSet(object.historyLength) ? globalThis.Number(object.historyLength) : isSet(object.history_length) ? globalThis.Number(object.history_length) : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.historyLength !== undefined) {
      obj.historyLength = Math.round(message.historyLength);
    }
    return obj;
  }
};
var ListTasksRequest = {
  fromJSON(object) {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      contextId: isSet(object.contextId) ? globalThis.String(object.contextId) : isSet(object.context_id) ? globalThis.String(object.context_id) : "",
      status: isSet(object.status) ? taskStateFromJSON(object.status) : 0,
      pageSize: isSet(object.pageSize) ? globalThis.Number(object.pageSize) : isSet(object.page_size) ? globalThis.Number(object.page_size) : undefined,
      pageToken: isSet(object.pageToken) ? globalThis.String(object.pageToken) : isSet(object.page_token) ? globalThis.String(object.page_token) : "",
      historyLength: isSet(object.historyLength) ? globalThis.Number(object.historyLength) : isSet(object.history_length) ? globalThis.Number(object.history_length) : undefined,
      statusTimestampAfter: isSet(object.statusTimestampAfter) ? globalThis.String(object.statusTimestampAfter) : isSet(object.status_timestamp_after) ? globalThis.String(object.status_timestamp_after) : undefined,
      includeArtifacts: isSet(object.includeArtifacts) ? globalThis.Boolean(object.includeArtifacts) : isSet(object.include_artifacts) ? globalThis.Boolean(object.include_artifacts) : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.status !== 0) {
      obj.status = taskStateToJSON(message.status);
    }
    if (message.pageSize !== undefined) {
      obj.pageSize = Math.round(message.pageSize);
    }
    if (message.pageToken !== "") {
      obj.pageToken = message.pageToken;
    }
    if (message.historyLength !== undefined) {
      obj.historyLength = Math.round(message.historyLength);
    }
    if (message.statusTimestampAfter !== undefined) {
      obj.statusTimestampAfter = message.statusTimestampAfter;
    }
    if (message.includeArtifacts !== undefined) {
      obj.includeArtifacts = message.includeArtifacts;
    }
    return obj;
  }
};
var ListTasksResponse = {
  fromJSON(object) {
    return {
      tasks: globalThis.Array.isArray(object?.tasks) ? object.tasks.map((e) => Task.fromJSON(e)) : [],
      nextPageToken: isSet(object.nextPageToken) ? globalThis.String(object.nextPageToken) : isSet(object.next_page_token) ? globalThis.String(object.next_page_token) : "",
      pageSize: isSet(object.pageSize) ? globalThis.Number(object.pageSize) : isSet(object.page_size) ? globalThis.Number(object.page_size) : 0,
      totalSize: isSet(object.totalSize) ? globalThis.Number(object.totalSize) : isSet(object.total_size) ? globalThis.Number(object.total_size) : 0
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tasks?.length) {
      obj.tasks = message.tasks.map((e) => Task.toJSON(e));
    }
    if (message.nextPageToken !== "") {
      obj.nextPageToken = message.nextPageToken;
    }
    if (message.pageSize !== 0) {
      obj.pageSize = Math.round(message.pageSize);
    }
    if (message.totalSize !== 0) {
      obj.totalSize = Math.round(message.totalSize);
    }
    return obj;
  }
};
var CancelTaskRequest = {
  fromJSON(object) {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      id: isSet(object.id) ? globalThis.String(object.id) : "",
      metadata: isObject(object.metadata) ? object.metadata : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  }
};
var GetTaskPushNotificationConfigRequest = {
  fromJSON(object) {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      taskId: isSet(object.taskId) ? globalThis.String(object.taskId) : isSet(object.task_id) ? globalThis.String(object.task_id) : "",
      id: isSet(object.id) ? globalThis.String(object.id) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    return obj;
  }
};
var DeleteTaskPushNotificationConfigRequest = {
  fromJSON(object) {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      taskId: isSet(object.taskId) ? globalThis.String(object.taskId) : isSet(object.task_id) ? globalThis.String(object.task_id) : "",
      id: isSet(object.id) ? globalThis.String(object.id) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    return obj;
  }
};
var SubscribeToTaskRequest = {
  fromJSON(object) {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      id: isSet(object.id) ? globalThis.String(object.id) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.id !== "") {
      obj.id = message.id;
    }
    return obj;
  }
};
var ListTaskPushNotificationConfigsRequest = {
  fromJSON(object) {
    return {
      tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "",
      taskId: isSet(object.taskId) ? globalThis.String(object.taskId) : isSet(object.task_id) ? globalThis.String(object.task_id) : "",
      pageSize: isSet(object.pageSize) ? globalThis.Number(object.pageSize) : isSet(object.page_size) ? globalThis.Number(object.page_size) : 0,
      pageToken: isSet(object.pageToken) ? globalThis.String(object.pageToken) : isSet(object.page_token) ? globalThis.String(object.page_token) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.pageSize !== 0) {
      obj.pageSize = Math.round(message.pageSize);
    }
    if (message.pageToken !== "") {
      obj.pageToken = message.pageToken;
    }
    return obj;
  }
};
var GetExtendedAgentCardRequest = {
  fromJSON(object) {
    return { tenant: isSet(object.tenant) ? globalThis.String(object.tenant) : "" };
  },
  toJSON(message) {
    const obj = {};
    if (message.tenant !== "") {
      obj.tenant = message.tenant;
    }
    return obj;
  }
};
var SendMessageResponse = {
  fromJSON(object) {
    return {
      payload: isSet(object.task) ? { $case: "task", value: Task.fromJSON(object.task) } : isSet(object.message) ? { $case: "message", value: Message.fromJSON(object.message) } : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.payload?.$case === "task") {
      obj.task = Task.toJSON(message.payload.value);
    } else if (message.payload?.$case === "message") {
      obj.message = Message.toJSON(message.payload.value);
    }
    return obj;
  }
};
var StreamResponse = {
  fromJSON(object) {
    return {
      payload: isSet(object.task) ? { $case: "task", value: Task.fromJSON(object.task) } : isSet(object.message) ? { $case: "message", value: Message.fromJSON(object.message) } : isSet(object.statusUpdate) ? { $case: "statusUpdate", value: TaskStatusUpdateEvent.fromJSON(object.statusUpdate) } : isSet(object.status_update) ? { $case: "statusUpdate", value: TaskStatusUpdateEvent.fromJSON(object.status_update) } : isSet(object.artifactUpdate) ? { $case: "artifactUpdate", value: TaskArtifactUpdateEvent.fromJSON(object.artifactUpdate) } : isSet(object.artifact_update) ? { $case: "artifactUpdate", value: TaskArtifactUpdateEvent.fromJSON(object.artifact_update) } : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.payload?.$case === "task") {
      obj.task = Task.toJSON(message.payload.value);
    } else if (message.payload?.$case === "message") {
      obj.message = Message.toJSON(message.payload.value);
    } else if (message.payload?.$case === "statusUpdate") {
      obj.statusUpdate = TaskStatusUpdateEvent.toJSON(message.payload.value);
    } else if (message.payload?.$case === "artifactUpdate") {
      obj.artifactUpdate = TaskArtifactUpdateEvent.toJSON(message.payload.value);
    }
    return obj;
  }
};
var ListTaskPushNotificationConfigsResponse = {
  fromJSON(object) {
    return {
      configs: globalThis.Array.isArray(object?.configs) ? object.configs.map((e) => TaskPushNotificationConfig.fromJSON(e)) : [],
      nextPageToken: isSet(object.nextPageToken) ? globalThis.String(object.nextPageToken) : isSet(object.next_page_token) ? globalThis.String(object.next_page_token) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.configs?.length) {
      obj.configs = message.configs.map((e) => TaskPushNotificationConfig.toJSON(e));
    }
    if (message.nextPageToken !== "") {
      obj.nextPageToken = message.nextPageToken;
    }
    return obj;
  }
};
function bytesFromBase64(b64) {
  return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
}
function base64FromBytes(arr) {
  return globalThis.Buffer.from(arr).toString("base64");
}
function isObject(value) {
  return typeof value === "object" && value !== null;
}
function isSet(value) {
  return value !== null && value !== undefined;
}
var DEFAULT_MAX_SSE_EVENT_SIZE_BYTES2 = 4 * 1024 * 1024;
async function* parseSseStream(response, maxEventSizeBytes = DEFAULT_MAX_SSE_EVENT_SIZE_BYTES2) {
  if (!response.body) {
    throw new Error("SSE response body is undefined. Cannot read stream.");
  }
  let buffer = "";
  let eventType = "message";
  let eventData = "";
  const stream = response.body.pipeThrough(new TextDecoderStream);
  for await (const value of readFrom(stream)) {
    buffer += value;
    let lineEndIndex;
    while ((lineEndIndex = buffer.indexOf(`
`)) >= 0) {
      if (lineEndIndex > maxEventSizeBytes) {
        throw sseSizeError("SSE line", maxEventSizeBytes);
      }
      let line = buffer.substring(0, lineEndIndex);
      if (line.endsWith("\r"))
        line = line.substring(0, line.length - 1);
      buffer = buffer.substring(lineEndIndex + 1);
      if (line === "") {
        if (eventData) {
          yield { type: eventType, data: eventData };
          eventData = "";
          eventType = "message";
        }
      } else if (line.startsWith(":")) {} else if (line.startsWith("event:")) {
        eventType = stripOptionalLeadingSpace(line.substring("event:".length));
      } else if (line.startsWith("data:")) {
        const fieldValue = stripOptionalLeadingSpace(line.substring("data:".length));
        eventData = eventData === "" ? fieldValue : `${eventData}
${fieldValue}`;
        if (eventData.length > maxEventSizeBytes) {
          throw sseSizeError("SSE event data", maxEventSizeBytes);
        }
      }
    }
    if (buffer.length > maxEventSizeBytes) {
      throw sseSizeError("SSE line", maxEventSizeBytes);
    }
  }
  if (eventData) {
    yield { type: eventType, data: eventData };
  }
}
function sseSizeError(what, maxEventSizeBytes) {
  return new Error(`${what} exceeded the maximum allowed size of ${maxEventSizeBytes} bytes. Pass maxEventSizeBytes to raise the limit, or prefer FileWithUri parts for large payloads.`);
}
function stripOptionalLeadingSpace(value) {
  return value.startsWith(" ") ? value.substring(1) : value;
}
async function* readFrom(stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
var A2A_ERROR_DOMAIN = "a2a-protocol.org";
var ERROR_INFO_TYPE = "type.googleapis.com/google.rpc.ErrorInfo";
var A2A_ERROR_BRAND = /* @__PURE__ */ Symbol.for("@a2a-js/sdk.A2AError");
var A2AError = class _A2AError extends Error {
  reason = "INTERNAL_ERROR";
  metadata;
  static [Symbol.hasInstance](value) {
    if (typeof value !== "object" || value === null || !(A2A_ERROR_BRAND in value))
      return false;
    if (this === _A2AError)
      return true;
    for (let proto = Object.getPrototypeOf(value);proto !== null; proto = Object.getPrototypeOf(proto)) {
      if (proto.constructor?.name === this.name) {
        return true;
      }
    }
    return false;
  }
  constructor(options) {
    const opts = typeof options === "string" ? { message: options } : options;
    super(opts?.message ?? "An unexpected error occurred.", opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = new.target.name;
    if (opts?.metadata && Object.keys(opts.metadata).length > 0) {
      this.metadata = opts.metadata;
    }
  }
  toErrorInfo() {
    return {
      "@type": ERROR_INFO_TYPE,
      reason: this.reason,
      domain: A2A_ERROR_DOMAIN,
      ...this.metadata ? { metadata: this.metadata } : {}
    };
  }
};
Object.defineProperty(A2AError.prototype, A2A_ERROR_BRAND, { value: true });
var specs = [
  { name: "TaskNotFoundError", reason: "TASK_NOT_FOUND", defaultMessage: "Task not found" },
  {
    name: "TaskNotCancelableError",
    reason: "TASK_NOT_CANCELABLE",
    defaultMessage: "Task cannot be canceled"
  },
  {
    name: "PushNotificationNotSupportedError",
    reason: "PUSH_NOTIFICATION_NOT_SUPPORTED",
    defaultMessage: "Push Notification is not supported"
  },
  {
    name: "UnsupportedOperationError",
    reason: "UNSUPPORTED_OPERATION",
    defaultMessage: "This operation is not supported"
  },
  {
    name: "ContentTypeNotSupportedError",
    reason: "CONTENT_TYPE_NOT_SUPPORTED",
    defaultMessage: "Incompatible content types"
  },
  {
    name: "InvalidAgentResponseError",
    reason: "INVALID_AGENT_RESPONSE",
    defaultMessage: "Invalid agent response type"
  },
  {
    name: "ExtendedAgentCardNotConfiguredError",
    reason: "EXTENDED_AGENT_CARD_NOT_CONFIGURED",
    defaultMessage: "Extended Agent Card not configured"
  },
  {
    name: "ExtensionSupportRequiredError",
    reason: "EXTENSION_SUPPORT_REQUIRED",
    defaultMessage: "Extension support required"
  },
  {
    name: "VersionNotSupportedError",
    reason: "VERSION_NOT_SUPPORTED",
    defaultMessage: "Version not supported"
  },
  {
    name: "RequestMalformedError",
    reason: "INVALID_PARAMS",
    defaultMessage: "Request malformed"
  }
];
var A2A_ERROR_SPECS = Object.freeze(Object.fromEntries(specs.map((s) => [s.name, s])));
var A2A_ERROR_SPECS_BY_REASON = Object.freeze(Object.fromEntries(specs.map((s) => [s.reason, s])));
function makeSemantic(spec) {
  const cls = {
    [spec.name]: class extends A2AError {
      reason = spec.reason;
      constructor(options) {
        if (options === undefined)
          super({ message: spec.defaultMessage });
        else if (typeof options === "string")
          super({ message: options });
        else
          super({ message: spec.defaultMessage, ...options });
      }
    }
  }[spec.name];
  return cls;
}
var TaskNotFoundError = makeSemantic(A2A_ERROR_SPECS.TaskNotFoundError);
var TaskNotCancelableError = makeSemantic(A2A_ERROR_SPECS.TaskNotCancelableError);
var PushNotificationNotSupportedError = makeSemantic(A2A_ERROR_SPECS.PushNotificationNotSupportedError);
var UnsupportedOperationError = makeSemantic(A2A_ERROR_SPECS.UnsupportedOperationError);
var ContentTypeNotSupportedError = makeSemantic(A2A_ERROR_SPECS.ContentTypeNotSupportedError);
var InvalidAgentResponseError = makeSemantic(A2A_ERROR_SPECS.InvalidAgentResponseError);
var ExtendedAgentCardNotConfiguredError = makeSemantic(A2A_ERROR_SPECS.ExtendedAgentCardNotConfiguredError);
var ExtensionSupportRequiredError = makeSemantic(A2A_ERROR_SPECS.ExtensionSupportRequiredError);
var VersionNotSupportedError = makeSemantic(A2A_ERROR_SPECS.VersionNotSupportedError);
var RequestMalformedError = makeSemantic(A2A_ERROR_SPECS.RequestMalformedError);
var A2A_ERROR_CLASSES = Object.freeze({
  TaskNotFoundError,
  TaskNotCancelableError,
  PushNotificationNotSupportedError,
  UnsupportedOperationError,
  ContentTypeNotSupportedError,
  InvalidAgentResponseError,
  ExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError,
  VersionNotSupportedError,
  RequestMalformedError
});
var HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501
};
var REST_STATUS_NAME = {
  OK: "OK",
  CANCELLED: "CANCELLED",
  UNKNOWN: "UNKNOWN",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  DEADLINE_EXCEEDED: "DEADLINE_EXCEEDED",
  NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  RESOURCE_EXHAUSTED: "RESOURCE_EXHAUSTED",
  FAILED_PRECONDITION: "FAILED_PRECONDITION",
  ABORTED: "ABORTED",
  OUT_OF_RANGE: "OUT_OF_RANGE",
  UNIMPLEMENTED: "UNIMPLEMENTED",
  INTERNAL: "INTERNAL",
  UNAVAILABLE: "UNAVAILABLE",
  DATA_LOSS: "DATA_LOSS",
  UNAUTHENTICATED: "UNAUTHENTICATED"
};
var REST_ERROR_HTTP_STATUS = Object.freeze({
  TaskNotFoundError: HTTP_STATUS.NOT_FOUND,
  TaskNotCancelableError: HTTP_STATUS.BAD_REQUEST,
  PushNotificationNotSupportedError: HTTP_STATUS.BAD_REQUEST,
  UnsupportedOperationError: HTTP_STATUS.BAD_REQUEST,
  ContentTypeNotSupportedError: HTTP_STATUS.BAD_REQUEST,
  InvalidAgentResponseError: HTTP_STATUS.INTERNAL_SERVER_ERROR,
  ExtendedAgentCardNotConfiguredError: HTTP_STATUS.BAD_REQUEST,
  ExtensionSupportRequiredError: HTTP_STATUS.BAD_REQUEST,
  VersionNotSupportedError: HTTP_STATUS.BAD_REQUEST,
  RequestMalformedError: HTTP_STATUS.BAD_REQUEST
});
var REST_ERROR_STATUS_NAME = Object.freeze({
  TaskNotFoundError: REST_STATUS_NAME.NOT_FOUND,
  TaskNotCancelableError: REST_STATUS_NAME.FAILED_PRECONDITION,
  PushNotificationNotSupportedError: REST_STATUS_NAME.FAILED_PRECONDITION,
  UnsupportedOperationError: REST_STATUS_NAME.FAILED_PRECONDITION,
  ContentTypeNotSupportedError: REST_STATUS_NAME.INVALID_ARGUMENT,
  InvalidAgentResponseError: REST_STATUS_NAME.INTERNAL,
  ExtendedAgentCardNotConfiguredError: REST_STATUS_NAME.FAILED_PRECONDITION,
  ExtensionSupportRequiredError: REST_STATUS_NAME.FAILED_PRECONDITION,
  VersionNotSupportedError: REST_STATUS_NAME.FAILED_PRECONDITION,
  RequestMalformedError: REST_STATUS_NAME.INVALID_ARGUMENT
});
function makeRest(name) {
  const Base = A2A_ERROR_CLASSES[name];
  const defaultStatus = REST_ERROR_HTTP_STATUS[name] ?? HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const cls = {
    [`Rest${name}`]: class extends Base {
      transport = "rest";
      statusCode;
      headers;
      constructor(options) {
        super(options);
        this.name = name;
        this.statusCode = options?.statusCode ?? defaultStatus;
        if (options?.headers)
          this.headers = options.headers;
      }
    }
  }[`Rest${name}`];
  return cls;
}
var RestTaskNotFoundError = makeRest("TaskNotFoundError");
var RestTaskNotCancelableError = makeRest("TaskNotCancelableError");
var RestPushNotificationNotSupportedError = makeRest("PushNotificationNotSupportedError");
var RestUnsupportedOperationError = makeRest("UnsupportedOperationError");
var RestContentTypeNotSupportedError = makeRest("ContentTypeNotSupportedError");
var RestInvalidAgentResponseError = makeRest("InvalidAgentResponseError");
var RestExtendedAgentCardNotConfiguredError = makeRest("ExtendedAgentCardNotConfiguredError");
var RestExtensionSupportRequiredError = makeRest("ExtensionSupportRequiredError");
var RestVersionNotSupportedError = makeRest("VersionNotSupportedError");
var RestRequestMalformedError = makeRest("RequestMalformedError");
var REST_ERROR_CLASSES = Object.freeze({
  TaskNotFoundError: RestTaskNotFoundError,
  TaskNotCancelableError: RestTaskNotCancelableError,
  PushNotificationNotSupportedError: RestPushNotificationNotSupportedError,
  UnsupportedOperationError: RestUnsupportedOperationError,
  ContentTypeNotSupportedError: RestContentTypeNotSupportedError,
  InvalidAgentResponseError: RestInvalidAgentResponseError,
  ExtendedAgentCardNotConfiguredError: RestExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError: RestExtensionSupportRequiredError,
  VersionNotSupportedError: RestVersionNotSupportedError,
  RequestMalformedError: RestRequestMalformedError
});
function fromRestErrorBody(body, transportCtx) {
  const message = body.message || "Unknown error";
  const details = body.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d["@type"] === ERROR_INFO_TYPE && typeof d.reason === "string") {
        const spec = A2A_ERROR_SPECS_BY_REASON[d.reason];
        if (spec) {
          const metadata = d.domain === A2A_ERROR_DOMAIN && d.metadata && typeof d.metadata === "object" ? d.metadata : undefined;
          return new REST_ERROR_CLASSES[spec.name]({ message, metadata, ...transportCtx });
        }
      }
    }
  }
  return new RestA2AErrorImpl({ message, ...transportCtx });
}
var RestA2AErrorImpl = class extends A2AError {
  transport = "rest";
  statusCode;
  headers;
  constructor(options) {
    super(options);
    this.name = "A2AError";
    this.statusCode = options?.statusCode ?? HTTP_STATUS.INTERNAL_SERVER_ERROR;
    if (options?.headers)
      this.headers = options.headers;
  }
};
var A2A_ERROR_CODE = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  EXTENDED_CARD_NOT_CONFIGURED: -32007,
  EXTENSION_SUPPORT_REQUIRED: -32008,
  VERSION_NOT_SUPPORTED: -32009
};
var JSON_RPC_ERROR_CODE = Object.freeze({
  TaskNotFoundError: A2A_ERROR_CODE.TASK_NOT_FOUND,
  TaskNotCancelableError: A2A_ERROR_CODE.TASK_NOT_CANCELABLE,
  PushNotificationNotSupportedError: A2A_ERROR_CODE.PUSH_NOTIFICATION_NOT_SUPPORTED,
  UnsupportedOperationError: A2A_ERROR_CODE.UNSUPPORTED_OPERATION,
  ContentTypeNotSupportedError: A2A_ERROR_CODE.CONTENT_TYPE_NOT_SUPPORTED,
  InvalidAgentResponseError: A2A_ERROR_CODE.INVALID_AGENT_RESPONSE,
  ExtendedAgentCardNotConfiguredError: A2A_ERROR_CODE.EXTENDED_CARD_NOT_CONFIGURED,
  ExtensionSupportRequiredError: A2A_ERROR_CODE.EXTENSION_SUPPORT_REQUIRED,
  VersionNotSupportedError: A2A_ERROR_CODE.VERSION_NOT_SUPPORTED,
  RequestMalformedError: A2A_ERROR_CODE.INVALID_PARAMS
});
var JSON_RPC_CODE_TO_ERROR = Object.freeze(Object.fromEntries(Object.entries(JSON_RPC_ERROR_CODE).map(([name, code]) => [code, name])));
function makeJsonRpc(name) {
  const Base = A2A_ERROR_CLASSES[name];
  const defaultCode = JSON_RPC_ERROR_CODE[name] ?? A2A_ERROR_CODE.INTERNAL_ERROR;
  const cls = {
    [`JsonRpc${name}`]: class extends Base {
      transport = "jsonrpc";
      envelopeCode;
      data;
      constructor(options) {
        super(options);
        this.name = name;
        this.envelopeCode = options?.envelopeCode ?? defaultCode;
        if (options?.data !== undefined)
          this.data = options.data;
      }
    }
  }[`JsonRpc${name}`];
  return cls;
}
var JsonRpcTaskNotFoundError = makeJsonRpc("TaskNotFoundError");
var JsonRpcTaskNotCancelableError = makeJsonRpc("TaskNotCancelableError");
var JsonRpcPushNotificationNotSupportedError = makeJsonRpc("PushNotificationNotSupportedError");
var JsonRpcUnsupportedOperationError = makeJsonRpc("UnsupportedOperationError");
var JsonRpcContentTypeNotSupportedError = makeJsonRpc("ContentTypeNotSupportedError");
var JsonRpcInvalidAgentResponseError = makeJsonRpc("InvalidAgentResponseError");
var JsonRpcExtendedAgentCardNotConfiguredError = makeJsonRpc("ExtendedAgentCardNotConfiguredError");
var JsonRpcExtensionSupportRequiredError = makeJsonRpc("ExtensionSupportRequiredError");
var JsonRpcVersionNotSupportedError = makeJsonRpc("VersionNotSupportedError");
var JsonRpcRequestMalformedError = makeJsonRpc("RequestMalformedError");
var JSON_RPC_ERROR_CLASSES = Object.freeze({
  TaskNotFoundError: JsonRpcTaskNotFoundError,
  TaskNotCancelableError: JsonRpcTaskNotCancelableError,
  PushNotificationNotSupportedError: JsonRpcPushNotificationNotSupportedError,
  UnsupportedOperationError: JsonRpcUnsupportedOperationError,
  ContentTypeNotSupportedError: JsonRpcContentTypeNotSupportedError,
  InvalidAgentResponseError: JsonRpcInvalidAgentResponseError,
  ExtendedAgentCardNotConfiguredError: JsonRpcExtendedAgentCardNotConfiguredError,
  ExtensionSupportRequiredError: JsonRpcExtensionSupportRequiredError,
  VersionNotSupportedError: JsonRpcVersionNotSupportedError,
  RequestMalformedError: JsonRpcRequestMalformedError
});
var JsonRpcTransportError = class extends A2AError {
  transport = "jsonrpc";
  envelopeCode;
  data;
  errorResponse;
  constructor(envelope) {
    super({ message: envelope.error.message });
    this.name = "JsonRpcTransportError";
    this.envelopeCode = envelope.error.code;
    if (envelope.error.data !== undefined)
      this.data = envelope.error.data;
    this.errorResponse = envelope;
  }
};
var RESERVED_CODE_TO_SEMANTIC = {
  [A2A_ERROR_CODE.PARSE_ERROR]: "RequestMalformedError",
  [A2A_ERROR_CODE.INVALID_REQUEST]: "RequestMalformedError",
  [A2A_ERROR_CODE.METHOD_NOT_FOUND]: "RequestMalformedError"
};
function fromJsonRpcErrorResponse(response) {
  const semanticName = JSON_RPC_CODE_TO_ERROR[response.error.code] ?? RESERVED_CODE_TO_SEMANTIC[response.error.code];
  if (semanticName) {
    return new JSON_RPC_ERROR_CLASSES[semanticName]({
      message: response.error.message,
      envelopeCode: response.error.code,
      data: response.error.data
    });
  }
  return new JsonRpcTransportError(response);
}
var PROTOCOL_VERSION_0_3 = A2A_LEGACY_PROTOCOL_VERSION;
var PROTOCOL_VERSION_1_0 = A2A_PROTOCOL_VERSION;
function parseVersion(version) {
  const trimmed = version.trim();
  if (trimmed === "")
    return;
  const segments = trimmed.split(".");
  if (segments.length === 0)
    return;
  const major = Number.parseInt(segments[0], 10);
  if (!Number.isFinite(major) || major < 0)
    return;
  const minorRaw = segments[1];
  const minor = minorRaw === undefined ? 0 : Number.parseInt(minorRaw, 10);
  if (!Number.isFinite(minor) || minor < 0)
    return;
  return { major, minor };
}
function compareVersions(a, b) {
  if (a.major !== b.major)
    return a.major - b.major;
  return a.minor - b.minor;
}
function isLegacyVersion(version) {
  if (!version || version.trim() === "")
    return true;
  const v = parseVersion(version);
  if (!v)
    return false;
  const lower = parseVersion(PROTOCOL_VERSION_0_3);
  const upper = parseVersion(PROTOCOL_VERSION_1_0);
  if (!lower || !upper)
    return false;
  return compareVersions(v, lower) >= 0 && compareVersions(v, upper) < 0;
}
function makeA2AError(code, message, data) {
  const name = JSON_RPC_CODE_TO_ERROR[code];
  if (name) {
    return data === undefined ? new A2A_ERROR_CLASSES[name]({ message }) : new JSON_RPC_ERROR_CLASSES[name]({ message, envelopeCode: code, data });
  }
  if (code === A2A_ERROR_CODE.METHOD_NOT_FOUND) {
    return new JsonRpcUnsupportedOperationError({
      message,
      envelopeCode: code,
      data
    });
  }
  if (code === A2A_ERROR_CODE.PARSE_ERROR || code === A2A_ERROR_CODE.INVALID_REQUEST) {
    return new JsonRpcRequestMalformedError({
      message,
      envelopeCode: code,
      data
    });
  }
  return new JsonRpcTransportError({
    jsonrpc: "2.0",
    id: null,
    error: { code, message, data }
  });
}
var A2AError2 = makeA2AError;
Object.defineProperty(A2AError2, Symbol.hasInstance, {
  value: (v) => v instanceof A2AError
});
A2AError2.parseError = (message, data) => new JsonRpcRequestMalformedError({
  message,
  envelopeCode: A2A_ERROR_CODE.PARSE_ERROR,
  data
});
A2AError2.invalidRequest = (message, data) => new JsonRpcRequestMalformedError({
  message,
  envelopeCode: A2A_ERROR_CODE.INVALID_REQUEST,
  data
});
A2AError2.methodNotFound = (method) => new JsonRpcUnsupportedOperationError({
  message: `Method not found: ${method}`,
  envelopeCode: A2A_ERROR_CODE.METHOD_NOT_FOUND
});
A2AError2.invalidParams = (message, data) => data === undefined ? new RequestMalformedError({ message }) : new JsonRpcRequestMalformedError({
  message,
  envelopeCode: A2A_ERROR_CODE.INVALID_PARAMS,
  data
});
A2AError2.internalError = (message, data) => new JsonRpcTransportError({
  jsonrpc: "2.0",
  id: null,
  error: {
    code: A2A_ERROR_CODE.INTERNAL_ERROR,
    message,
    ...data !== undefined ? { data } : {}
  }
});
A2AError2.taskNotFound = (taskId) => new TaskNotFoundError({ message: `Task not found: ${taskId}` });
A2AError2.taskNotCancelable = (taskId) => new TaskNotCancelableError({ message: `Task not cancelable: ${taskId}` });
A2AError2.pushNotificationNotSupported = () => new PushNotificationNotSupportedError;
A2AError2.unsupportedOperation = (operation) => new UnsupportedOperationError({ message: `Unsupported operation: ${operation}` });
A2AError2.authenticatedExtendedCardNotConfigured = () => new ExtendedAgentCardNotConfiguredError({ message: "Extended card not configured." });
function toCoreSecurityRequirement(compat) {
  return {
    schemes: Object.fromEntries(Object.entries(compat).map(([scheme, scopes]) => [scheme, { list: [...scopes] }]))
  };
}
function buildV1ApiKeyScheme(scheme) {
  return {
    description: scheme.description ?? "",
    location: scheme.in,
    name: scheme.name
  };
}
function buildV1HttpScheme(scheme) {
  return {
    description: scheme.description ?? "",
    scheme: scheme.scheme,
    bearerFormat: scheme.bearerFormat ?? ""
  };
}
function buildV1MtlsScheme(scheme) {
  return { description: scheme.description ?? "" };
}
function buildV1Oauth2Scheme(scheme) {
  return {
    description: scheme.description ?? "",
    flows: toCoreOAuthFlows(scheme.flows),
    oauth2MetadataUrl: scheme.oauth2MetadataUrl ?? ""
  };
}
function buildV1OidcScheme(scheme) {
  return {
    description: scheme.description ?? "",
    openIdConnectUrl: scheme.openIdConnectUrl
  };
}
function toCoreSecurityScheme(compat) {
  switch (compat.type) {
    case "apiKey":
      return {
        scheme: { $case: "apiKeySecurityScheme", value: buildV1ApiKeyScheme(compat) }
      };
    case "http":
      return {
        scheme: { $case: "httpAuthSecurityScheme", value: buildV1HttpScheme(compat) }
      };
    case "oauth2":
      return {
        scheme: { $case: "oauth2SecurityScheme", value: buildV1Oauth2Scheme(compat) }
      };
    case "openIdConnect":
      return {
        scheme: { $case: "openIdConnectSecurityScheme", value: buildV1OidcScheme(compat) }
      };
    case "mutualTLS":
      return {
        scheme: { $case: "mtlsSecurityScheme", value: buildV1MtlsScheme(compat) }
      };
    default:
      throw A2AError2.invalidParams(`Unsupported v0.3 security scheme type: ${String(compat.type)}`);
  }
}
function toCoreOAuthFlows(compat) {
  if (compat.authorizationCode) {
    const authCode = compat.authorizationCode;
    const value = {
      authorizationUrl: authCode.authorizationUrl,
      tokenUrl: authCode.tokenUrl,
      refreshUrl: authCode.refreshUrl ?? "",
      scopes: { ...authCode.scopes },
      pkceRequired: false
    };
    return { flow: { $case: "authorizationCode", value } };
  }
  if (compat.clientCredentials) {
    const clientCreds = compat.clientCredentials;
    const value = {
      tokenUrl: clientCreds.tokenUrl,
      refreshUrl: clientCreds.refreshUrl ?? "",
      scopes: { ...clientCreds.scopes }
    };
    return { flow: { $case: "clientCredentials", value } };
  }
  if (compat.implicit) {
    const value = {
      authorizationUrl: compat.implicit.authorizationUrl,
      refreshUrl: compat.implicit.refreshUrl ?? "",
      scopes: { ...compat.implicit.scopes }
    };
    return { flow: { $case: "implicit", value } };
  }
  if (compat.password) {
    const value = {
      tokenUrl: compat.password.tokenUrl,
      refreshUrl: compat.password.refreshUrl ?? "",
      scopes: { ...compat.password.scopes }
    };
    return { flow: { $case: "password", value } };
  }
  throw A2AError2.invalidParams("OAuthFlows must declare at least one flow");
}
function deepCloneMetadata(metadata) {
  return metadata === undefined ? undefined : structuredClone(metadata);
}
function requireArray(value, path) {
  if (!Array.isArray(value)) {
    throw A2AError2.invalidParams(`${path} is required and must be an array`);
  }
  return value;
}
function requireObject(value, path) {
  if (value == null || typeof value !== "object") {
    throw A2AError2.invalidParams(`${path} is required`);
  }
  return value;
}
var DEFAULT_PREFERRED_TRANSPORT = "JSONRPC";
function toCoreAgentInterface(compat) {
  return {
    url: compat.url,
    protocolBinding: compat.transport,
    tenant: "",
    protocolVersion: PROTOCOL_VERSION_0_3
  };
}
function toCoreAgentProvider(compat) {
  return { url: compat.url, organization: compat.organization };
}
function toCoreAgentExtension(compat) {
  return {
    uri: compat.uri,
    description: compat.description ?? "",
    required: compat.required ?? false,
    params: deepCloneMetadata(compat.params)
  };
}
function toCoreAgentCapabilities(compat) {
  return {
    streaming: compat.streaming,
    pushNotifications: compat.pushNotifications,
    extensions: compat.extensions ? compat.extensions.map(toCoreAgentExtension) : [],
    extendedAgentCard: undefined
  };
}
function toCoreAgentSkill(compat) {
  return {
    id: compat.id,
    name: compat.name,
    description: compat.description,
    tags: [...requireArray(compat.tags, "skill.tags")],
    examples: compat.examples ? [...compat.examples] : [],
    inputModes: compat.inputModes ? [...compat.inputModes] : [],
    outputModes: compat.outputModes ? [...compat.outputModes] : [],
    securityRequirements: compat.security ? compat.security.map(toCoreSecurityRequirement) : []
  };
}
function toCoreAgentCardSignature(compat) {
  return {
    protected: compat.protected,
    signature: compat.signature,
    header: deepCloneMetadata(compat.header)
  };
}
function toCoreAgentCard(compat) {
  const primary = {
    url: compat.url,
    protocolBinding: compat.preferredTransport ?? DEFAULT_PREFERRED_TRANSPORT,
    tenant: "",
    protocolVersion: compat.protocolVersion || PROTOCOL_VERSION_0_3
  };
  const additional = compat.additionalInterfaces?.map(toCoreAgentInterface) ?? [];
  const supportedInterfaces = [primary, ...additional];
  const capabilities = toCoreAgentCapabilities(requireObject(compat.capabilities, "agentCard.capabilities"));
  if (compat.supportsAuthenticatedExtendedCard !== undefined) {
    capabilities.extendedAgentCard = compat.supportsAuthenticatedExtendedCard;
  }
  const result = {
    name: compat.name,
    description: compat.description,
    supportedInterfaces,
    provider: compat.provider ? toCoreAgentProvider(compat.provider) : undefined,
    version: compat.version,
    capabilities,
    securitySchemes: compat.securitySchemes ? Object.fromEntries(Object.entries(compat.securitySchemes).map(([key, scheme]) => [
      key,
      toCoreSecurityScheme(scheme)
    ])) : {},
    securityRequirements: compat.security ? compat.security.map(toCoreSecurityRequirement) : [],
    defaultInputModes: [...requireArray(compat.defaultInputModes, "agentCard.defaultInputModes")],
    defaultOutputModes: [
      ...requireArray(compat.defaultOutputModes, "agentCard.defaultOutputModes")
    ],
    skills: requireArray(compat.skills, "agentCard.skills").map(toCoreAgentSkill),
    signatures: compat.signatures ? compat.signatures.map(toCoreAgentCardSignature) : []
  };
  if (compat.documentationUrl !== undefined)
    result.documentationUrl = compat.documentationUrl;
  if (compat.iconUrl !== undefined)
    result.iconUrl = compat.iconUrl;
  return result;
}
var LEGACY_ONLY_TOP_LEVEL_FIELDS = [
  "preferredTransport",
  "additionalInterfaces",
  "supportsAuthenticatedExtendedCard"
];
function isLegacyAgentCard(raw) {
  if (!raw || typeof raw !== "object")
    return false;
  const card = raw;
  if (Array.isArray(card.supportedInterfaces) && card.supportedInterfaces.length > 0) {
    return false;
  }
  if (typeof card.url === "string" && !("supportedInterfaces" in card)) {
    return true;
  }
  for (const field of LEGACY_ONLY_TOP_LEVEL_FIELDS) {
    if (field in card)
      return true;
  }
  if (typeof card.protocolVersion === "string" && isLegacyVersion(card.protocolVersion)) {
    return true;
  }
  return false;
}
function parseLegacyAgentCard(raw) {
  return toCoreAgentCard(raw);
}
var LEGACY_HTTP_EXTENSION_HEADER = "X-A2A-Extensions";
var LEGACY_JSON_CONTENT_TYPE = "application/json";
var LEGACY_METHOD_MESSAGE_SEND = "message/send";
var LEGACY_METHOD_MESSAGE_STREAM = "message/stream";
var LEGACY_METHOD_TASKS_GET = "tasks/get";
var LEGACY_METHOD_TASKS_CANCEL = "tasks/cancel";
var LEGACY_METHOD_TASKS_RESUBSCRIBE = "tasks/resubscribe";
var LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET = "tasks/pushNotificationConfig/set";
var LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET = "tasks/pushNotificationConfig/get";
var LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST = "tasks/pushNotificationConfig/list";
var LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE = "tasks/pushNotificationConfig/delete";
var LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD = "agent/getAuthenticatedExtendedCard";
var LEGACY_JSONRPC_TO_V1 = Object.freeze({
  [LEGACY_METHOD_MESSAGE_SEND]: "SendMessage",
  [LEGACY_METHOD_MESSAGE_STREAM]: "SendStreamingMessage",
  [LEGACY_METHOD_TASKS_GET]: "GetTask",
  [LEGACY_METHOD_TASKS_CANCEL]: "CancelTask",
  [LEGACY_METHOD_TASKS_RESUBSCRIBE]: "SubscribeToTask",
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET]: "CreateTaskPushNotificationConfig",
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET]: "GetTaskPushNotificationConfig",
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST]: "ListTaskPushNotificationConfigs",
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE]: "DeleteTaskPushNotificationConfig",
  [LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD]: "GetExtendedAgentCard"
});
var V1_TO_LEGACY_JSONRPC = Object.freeze(Object.fromEntries(Object.entries(LEGACY_JSONRPC_TO_V1).map(([k, v]) => [v, k])));
var LEGACY_JSONRPC_TO_LEGACY_GRPC = Object.freeze({
  [LEGACY_METHOD_MESSAGE_SEND]: "SendMessage",
  [LEGACY_METHOD_MESSAGE_STREAM]: "SendStreamingMessage",
  [LEGACY_METHOD_TASKS_GET]: "GetTask",
  [LEGACY_METHOD_TASKS_CANCEL]: "CancelTask",
  [LEGACY_METHOD_TASKS_RESUBSCRIBE]: "TaskSubscription",
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_SET]: "CreateTaskPushNotificationConfig",
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_GET]: "GetTaskPushNotificationConfig",
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_LIST]: "ListTaskPushNotificationConfig",
  [LEGACY_METHOD_PUSH_NOTIFICATION_CONFIG_DELETE]: "DeleteTaskPushNotificationConfig",
  [LEGACY_METHOD_GET_AUTHENTICATED_EXTENDED_CARD]: "GetAgentCard"
});
var LEGACY_GRPC_TO_LEGACY_JSONRPC = Object.freeze(Object.fromEntries(Object.entries(LEGACY_JSONRPC_TO_LEGACY_GRPC).map(([k, v]) => [v, k])));
var LEGACY_GRPC_TO_V1 = Object.freeze(Object.fromEntries(Object.entries(LEGACY_JSONRPC_TO_LEGACY_GRPC).map(([jsonRpc, grpc]) => [
  grpc,
  LEGACY_JSONRPC_TO_V1[jsonRpc]
])));
var V1_TO_LEGACY_GRPC = Object.freeze(Object.fromEntries(Object.entries(LEGACY_GRPC_TO_V1).map(([k, v]) => [v, k])));
var TASK_STATE_COMPAT_TO_CORE = Object.freeze({
  unknown: 0,
  submitted: 1,
  working: 2,
  completed: 3,
  failed: 4,
  canceled: 5,
  "input-required": 6,
  rejected: 7,
  "auth-required": 8
});
var TASK_STATE_CORE_TO_COMPAT = new Map(Object.entries(TASK_STATE_COMPAT_TO_CORE).map(([literal, enumValue]) => [enumValue, literal]));
function toCoreTaskState(state) {
  return TASK_STATE_COMPAT_TO_CORE[state] ?? 0;
}
function toCoreRole(role) {
  if (role === "user")
    return 1;
  if (role === "agent")
    return 2;
  return 0;
}
function toCompatRole(role) {
  return role === 1 ? "user" : "agent";
}
var DATA_PART_COMPAT_FLAG = "data_part_compat";
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);
}
function isCompatWrappableDataValue(value) {
  if (value === null)
    return true;
  if (Array.isArray(value))
    return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}
function toCorePart(compatPart) {
  if (typeof compatPart !== "object" || compatPart === null || Array.isArray(compatPart)) {
    throw A2AError2.invalidParams("Each part must be an object");
  }
  if (compatPart.kind === "text") {
    return {
      content: { $case: "text", value: compatPart.text },
      metadata: deepCloneMetadata(compatPart.metadata),
      filename: "",
      mediaType: ""
    };
  }
  if (compatPart.kind === "file") {
    const file = compatPart.file;
    const mediaType = file.mimeType ?? "";
    const filename = file.name ?? "";
    const metadata = deepCloneMetadata(compatPart.metadata);
    if ("bytes" in file) {
      return {
        content: { $case: "raw", value: Buffer.from(file.bytes, "base64") },
        metadata,
        filename,
        mediaType
      };
    }
    if ("uri" in file) {
      return {
        content: { $case: "url", value: file.uri },
        metadata,
        filename,
        mediaType
      };
    }
    throw A2AError2.invalidParams("Invalid file part: missing `bytes` or `uri`");
  }
  if (compatPart.kind === "data") {
    const metadata = deepCloneMetadata(compatPart.metadata);
    let value = compatPart.data;
    let outMetadata = metadata;
    if (metadata !== undefined && metadata[DATA_PART_COMPAT_FLAG] === true) {
      if (isPlainObject(compatPart.data) && "value" in compatPart.data) {
        value = compatPart.data.value;
      }
      delete metadata[DATA_PART_COMPAT_FLAG];
      outMetadata = Object.keys(metadata).length > 0 ? metadata : undefined;
    }
    return {
      content: { $case: "data", value },
      metadata: outMetadata,
      filename: "",
      mediaType: ""
    };
  }
  throw A2AError2.invalidParams(`Invalid v0.3 part kind: ${compatPart.kind ?? "undefined"}`);
}
function toCompatPart(corePart) {
  const content = corePart.content;
  const metadata = deepCloneMetadata(corePart.metadata);
  if (!content) {
    throw A2AError2.invalidParams("Invalid v1.0 part: missing content");
  }
  if (content.$case === "text") {
    const result = { kind: "text", text: content.value };
    if (metadata !== undefined)
      result.metadata = metadata;
    return result;
  }
  if (content.$case === "raw" || content.$case === "url") {
    const mimeType = corePart.mediaType !== "" ? corePart.mediaType : undefined;
    const name = corePart.filename !== "" ? corePart.filename : undefined;
    let file;
    if (content.$case === "raw") {
      const bytesBuffer = Buffer.isBuffer(content.value) ? content.value : Buffer.from(content.value);
      const fileWithBytes = { bytes: bytesBuffer.toString("base64") };
      if (mimeType !== undefined)
        fileWithBytes.mimeType = mimeType;
      if (name !== undefined)
        fileWithBytes.name = name;
      file = fileWithBytes;
    } else {
      const fileWithUri = { uri: content.value };
      if (mimeType !== undefined)
        fileWithUri.mimeType = mimeType;
      if (name !== undefined)
        fileWithUri.name = name;
      file = fileWithUri;
    }
    const result = { kind: "file", file };
    if (metadata !== undefined)
      result.metadata = metadata;
    return result;
  }
  if (content.$case === "data") {
    const value = content.value;
    if (isPlainObject(value)) {
      const result = { kind: "data", data: value };
      if (metadata !== undefined)
        result.metadata = metadata;
      return result;
    }
    if (isCompatWrappableDataValue(value)) {
      const data = { value };
      const outMetadata = metadata ?? {};
      outMetadata[DATA_PART_COMPAT_FLAG] = true;
      const result = { kind: "data", data, metadata: outMetadata };
      return result;
    }
    throw A2AError2.invalidParams("Cannot translate v1 data part to v0.3: value is neither a plain object nor a wrap-eligible primitive / array / null (e.g., Symbol, function, bigint, undefined, Buffer). Primitives, arrays, and null are wrapped as { value: ... } with data_part_compat=true; all other non-plain-object values are rejected.");
  }
  throw A2AError2.invalidParams(`Invalid v1.0 part content type: ${content.$case ?? "unknown"}`);
}
function nonEmptyString(value) {
  return value == null || value === "" ? undefined : value;
}
function nonEmptyArray(value) {
  return value == null || value.length === 0 ? undefined : [...value];
}
function toCoreMessage(compatMsg) {
  if (typeof compatMsg !== "object" || compatMsg === null) {
    throw A2AError2.invalidParams("message must be an object");
  }
  if (typeof compatMsg.messageId !== "string" || compatMsg.messageId === "") {
    throw A2AError2.invalidParams("message.messageId is required");
  }
  if (compatMsg.role !== "user" && compatMsg.role !== "agent") {
    throw A2AError2.invalidParams('message.role must be "user" or "agent"');
  }
  if (!Array.isArray(compatMsg.parts)) {
    throw A2AError2.invalidParams("message.parts must be an array");
  }
  return {
    messageId: compatMsg.messageId,
    contextId: compatMsg.contextId ?? "",
    taskId: compatMsg.taskId ?? "",
    role: toCoreRole(compatMsg.role),
    parts: compatMsg.parts.map(toCorePart),
    metadata: deepCloneMetadata(compatMsg.metadata),
    extensions: compatMsg.extensions ? [...compatMsg.extensions] : [],
    referenceTaskIds: compatMsg.referenceTaskIds ? [...compatMsg.referenceTaskIds] : []
  };
}
function toCompatMessage(coreMsg) {
  const result = {
    kind: "message",
    messageId: coreMsg.messageId,
    role: toCompatRole(coreMsg.role),
    parts: requireArray(coreMsg.parts, "message.parts").map(toCompatPart)
  };
  const contextId = nonEmptyString(coreMsg.contextId);
  if (contextId !== undefined)
    result.contextId = contextId;
  const taskId = nonEmptyString(coreMsg.taskId);
  if (taskId !== undefined)
    result.taskId = taskId;
  const metadata = deepCloneMetadata(coreMsg.metadata);
  if (metadata !== undefined)
    result.metadata = metadata;
  const extensions = nonEmptyArray(coreMsg.extensions);
  if (extensions !== undefined)
    result.extensions = extensions;
  const referenceTaskIds = nonEmptyArray(coreMsg.referenceTaskIds);
  if (referenceTaskIds !== undefined)
    result.referenceTaskIds = referenceTaskIds;
  return result;
}
function nonEmpty(value) {
  return value !== undefined && value !== "" ? value : undefined;
}
function toCoreAuthenticationInfo(compat) {
  if (compat.schemes && compat.schemes.length > 1) {
    console.warn(`toCoreAuthenticationInfo: Lossy conversion from v0.3 PushNotificationAuthenticationInfo to v1.0 AuthenticationInfo. Multiple schemes declared (${compat.schemes.join(", ")}), but only the first one ('${compat.schemes[0]}') will be kept.`);
  }
  return {
    scheme: compat.schemes && compat.schemes.length > 0 ? compat.schemes[0] : "",
    credentials: compat.credentials ?? ""
  };
}
function toCompatAuthenticationInfo(core) {
  const result = {
    schemes: core.scheme !== "" ? [core.scheme] : []
  };
  const credentials = nonEmpty(core.credentials);
  if (credentials !== undefined)
    result.credentials = credentials;
  return result;
}
function toCompatPushNotificationConfig(core) {
  const result = { url: core.url };
  const id = nonEmpty(core.id);
  if (id !== undefined)
    result.id = id;
  const token = nonEmpty(core.token);
  if (token !== undefined)
    result.token = token;
  if (core.authentication) {
    result.authentication = toCompatAuthenticationInfo(core.authentication);
  }
  return result;
}
function toCoreTaskPushNotificationConfig(compat, tenant = "") {
  return {
    tenant,
    taskId: compat.taskId,
    id: compat.pushNotificationConfig.id ?? "",
    url: compat.pushNotificationConfig.url,
    token: compat.pushNotificationConfig.token ?? "",
    authentication: compat.pushNotificationConfig.authentication ? toCoreAuthenticationInfo(compat.pushNotificationConfig.authentication) : undefined
  };
}
function toCompatTaskPushNotificationConfig(core) {
  return {
    taskId: core.taskId,
    pushNotificationConfig: toCompatPushNotificationConfig(core)
  };
}
function toCoreArtifact(compatArtifact) {
  return {
    artifactId: compatArtifact.artifactId,
    name: compatArtifact.name ?? "",
    description: compatArtifact.description ?? "",
    parts: requireArray(compatArtifact.parts, "artifact.parts").map(toCorePart),
    metadata: deepCloneMetadata(compatArtifact.metadata),
    extensions: compatArtifact.extensions ? [...compatArtifact.extensions] : []
  };
}
function toCoreTaskStatus(compatStatus) {
  return {
    state: toCoreTaskState(compatStatus.state),
    message: compatStatus.message ? toCoreMessage(compatStatus.message) : undefined,
    timestamp: compatStatus.timestamp
  };
}
function toCoreTask(compatTask) {
  return {
    id: compatTask.id,
    contextId: compatTask.contextId,
    status: toCoreTaskStatus(compatTask.status),
    artifacts: compatTask.artifacts ? compatTask.artifacts.map(toCoreArtifact) : [],
    history: compatTask.history ? compatTask.history.map(toCoreMessage) : [],
    metadata: deepCloneMetadata(compatTask.metadata)
  };
}
function toCoreTaskStatusUpdateEvent(compatEvent) {
  return {
    taskId: compatEvent.taskId,
    contextId: compatEvent.contextId,
    status: toCoreTaskStatus(compatEvent.status),
    metadata: deepCloneMetadata(compatEvent.metadata)
  };
}
function toCoreTaskArtifactUpdateEvent(compatEvent) {
  return {
    taskId: compatEvent.taskId,
    contextId: compatEvent.contextId,
    artifact: toCoreArtifact(compatEvent.artifact),
    append: compatEvent.append ?? false,
    lastChunk: compatEvent.lastChunk ?? false,
    metadata: deepCloneMetadata(compatEvent.metadata)
  };
}
function toCompatSendMessageConfiguration(core) {
  const result = {
    blocking: !core.returnImmediately
  };
  result.acceptedOutputModes = core.acceptedOutputModes ? [...core.acceptedOutputModes] : [];
  if (core.historyLength !== undefined)
    result.historyLength = core.historyLength;
  if (core.taskPushNotificationConfig) {
    result.pushNotificationConfig = toCompatPushNotificationConfig(core.taskPushNotificationConfig);
  }
  return result;
}
function toCompatSendMessageRequest(core, requestId) {
  if (!core.message) {
    throw A2AError2.invalidParams("SendMessageRequest missing message");
  }
  const params = {
    message: toCompatMessage(core.message)
  };
  if (core.configuration) {
    params.configuration = toCompatSendMessageConfiguration(core.configuration);
  }
  const metadata = deepCloneMetadata(core.metadata);
  if (metadata !== undefined)
    params.metadata = metadata;
  return { id: requestId, jsonrpc: "2.0", method: "message/send", params };
}
function toCompatSendStreamingMessageRequest(core, requestId) {
  const inner = toCompatSendMessageRequest(core, requestId);
  return { ...inner, method: "message/stream" };
}
function toCoreStreamResponse(compat) {
  if ("error" in compat) {
    throw A2AError2.internalError("Cannot translate a v0.3 error response into a v1.0 StreamResponse");
  }
  const result = compat.result;
  switch (result.kind) {
    case "message":
      return { payload: { $case: "message", value: toCoreMessage(result) } };
    case "task":
      return { payload: { $case: "task", value: toCoreTask(result) } };
    case "status-update":
      return {
        payload: { $case: "statusUpdate", value: toCoreTaskStatusUpdateEvent(result) }
      };
    case "artifact-update":
      return {
        payload: { $case: "artifactUpdate", value: toCoreTaskArtifactUpdateEvent(result) }
      };
    default:
      throw A2AError2.invalidParams(`Unknown v0.3 stream event kind: ${String(result.kind)}`);
  }
}
function toCompatGetTaskRequest(core, requestId) {
  const params = { id: core.id };
  if (core.historyLength !== undefined)
    params.historyLength = core.historyLength;
  return { id: requestId, jsonrpc: "2.0", method: "tasks/get", params };
}
function toCompatCancelTaskRequest(core, requestId) {
  const params = { id: core.id };
  const metadata = deepCloneMetadata(core.metadata);
  if (metadata !== undefined)
    params.metadata = metadata;
  return { id: requestId, jsonrpc: "2.0", method: "tasks/cancel", params };
}
function toCompatTaskResubscriptionRequest(core, requestId) {
  return {
    id: requestId,
    jsonrpc: "2.0",
    method: "tasks/resubscribe",
    params: { id: core.id }
  };
}
function toCompatSetTaskPushNotificationConfigRequest(core, requestId) {
  return {
    id: requestId,
    jsonrpc: "2.0",
    method: "tasks/pushNotificationConfig/set",
    params: toCompatTaskPushNotificationConfig(core)
  };
}
function toCompatGetTaskPushNotificationConfigRequest(core, requestId) {
  const params = core.id !== "" ? { id: core.taskId, pushNotificationConfigId: core.id } : { id: core.taskId };
  return {
    id: requestId,
    jsonrpc: "2.0",
    method: "tasks/pushNotificationConfig/get",
    params
  };
}
function toCompatDeleteTaskPushNotificationConfigRequest(core, requestId) {
  return {
    id: requestId,
    jsonrpc: "2.0",
    method: "tasks/pushNotificationConfig/delete",
    params: { id: core.taskId, pushNotificationConfigId: core.id }
  };
}
function toCompatListTaskPushNotificationConfigRequest(core, requestId) {
  return {
    id: requestId,
    jsonrpc: "2.0",
    method: "tasks/pushNotificationConfig/list",
    params: { id: core.taskId }
  };
}
function toCoreListTaskPushNotificationConfigsResponse(compat) {
  return {
    configs: compat.result.map((entry) => toCoreTaskPushNotificationConfig(entry)),
    nextPageToken: ""
  };
}
function toCompatGetAuthenticatedExtendedCardRequest(_core, requestId) {
  return {
    id: requestId,
    jsonrpc: "2.0",
    method: "agent/getAuthenticatedExtendedCard"
  };
}
var PROTOCOL_NAME = "JSONRPC";
var LegacyJsonRpcTransport = class _LegacyJsonRpcTransport {
  customFetchImpl;
  endpoint;
  requestIdCounter = 1;
  constructor(options) {
    this.endpoint = options.endpoint;
    this.customFetchImpl = options.fetchImpl;
  }
  get protocolName() {
    return PROTOCOL_NAME;
  }
  get protocolVersion() {
    return A2A_LEGACY_PROTOCOL_VERSION;
  }
  async getExtendedAgentCard(_params, options) {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatGetAuthenticatedExtendedCardRequest({ tenant: "" }, requestId);
    const response = await this._sendRpcRequest(envelope, options);
    return toCoreAgentCard(response.result);
  }
  async sendMessage(params, options) {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatSendMessageRequest(params, requestId);
    const response = await this._sendRpcRequest(envelope, options);
    return _LegacyJsonRpcTransport._parseSendMessageResult(response.result);
  }
  async* sendMessageStream(params, options) {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatSendStreamingMessageRequest(params, requestId);
    yield* this._sendStreamingRequest(envelope, options);
  }
  async createTaskPushNotificationConfig(params, options) {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatSetTaskPushNotificationConfigRequest(params, requestId);
    const response = await this._sendRpcRequest(envelope, options);
    return toCoreTaskPushNotificationConfig(response.result);
  }
  async getTaskPushNotificationConfig(params, options) {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatGetTaskPushNotificationConfigRequest(params, requestId);
    const response = await this._sendRpcRequest(envelope, options);
    return toCoreTaskPushNotificationConfig(response.result);
  }
  async listTaskPushNotificationConfig(params, options) {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatListTaskPushNotificationConfigRequest(params, requestId);
    const response = await this._sendRpcRequest(envelope, options);
    return toCoreListTaskPushNotificationConfigsResponse({
      id: response.id,
      jsonrpc: "2.0",
      result: response.result
    });
  }
  async deleteTaskPushNotificationConfig(params, options) {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatDeleteTaskPushNotificationConfigRequest(params, requestId);
    await this._sendRpcRequest(envelope, options);
  }
  async getTask(params, options) {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatGetTaskRequest(params, requestId);
    const response = await this._sendRpcRequest(envelope, options);
    return toCoreTask(response.result);
  }
  async cancelTask(params, options) {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatCancelTaskRequest(params, requestId);
    const response = await this._sendRpcRequest(envelope, options);
    return toCoreTask(response.result);
  }
  async listTasks(_params, _options) {
    throw new JsonRpcTransportError({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: A2A_ERROR_CODE.METHOD_NOT_FOUND,
        message: "Method not found: tasks/list"
      }
    });
  }
  async* resubscribeTask(params, options) {
    const requestId = this.requestIdCounter++;
    const envelope = toCompatTaskResubscriptionRequest(params, requestId);
    yield* this._sendStreamingRequest(envelope, options);
  }
  _fetch(...args) {
    if (this.customFetchImpl) {
      return this.customFetchImpl(...args);
    }
    if (typeof fetch === "function") {
      return fetch(...args);
    }
    throw new Error("A `fetch` implementation was not provided and is not available in the global scope. Please provide a `fetchImpl` in the LegacyJsonRpcTransportOptions.");
  }
  async _sendRpcRequest(rpcRequest, options) {
    const httpResponse = await this._fetchRpc(rpcRequest, JSON_CONTENT_TYPE, options);
    if (!httpResponse.ok) {
      let errorBodyText = "(empty or non-JSON response)";
      let errorJson;
      try {
        errorBodyText = await httpResponse.text();
        errorJson = JSON.parse(errorBodyText);
      } catch (e) {
        throw new Error(`HTTP error for ${rpcRequest.method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`, { cause: e });
      }
      if (errorJson.jsonrpc && errorJson.error) {
        throw fromJsonRpcErrorResponse(errorJson);
      }
      throw new Error(`HTTP error for ${rpcRequest.method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`);
    }
    const json = await httpResponse.json();
    if ("error" in json) {
      throw fromJsonRpcErrorResponse(json);
    }
    if (json.id !== rpcRequest.id) {
      throw new Error(`JSON-RPC response ID mismatch for method ${rpcRequest.method}. Expected ${rpcRequest.id}, got ${json.id}.`);
    }
    return json;
  }
  async _fetchRpc(rpcRequest, acceptHeader, options) {
    const requestInit = {
      method: "POST",
      headers: {
        ...options?.serviceParameters,
        "Content-Type": JSON_CONTENT_TYPE,
        Accept: acceptHeader
      },
      body: JSON.stringify(rpcRequest),
      signal: options?.signal
    };
    return this._fetch(this.endpoint, requestInit);
  }
  async* _sendStreamingRequest(rpcRequest, options) {
    const response = await this._fetchRpc(rpcRequest, "text/event-stream", options);
    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
        const errorJson = JSON.parse(errorBody);
        if (errorJson.error) {
          throw fromJsonRpcErrorResponse(errorJson);
        }
      } catch (e) {
        if (e instanceof Error && e.name !== "SyntaxError") {
          throw e;
        }
      }
      throw new Error(`HTTP error establishing stream for ${rpcRequest.method}: ${response.status} ${response.statusText}. Response: ${errorBody || "(empty)"}`);
    }
    if (!response.headers.get("Content-Type")?.startsWith("text/event-stream")) {
      try {
        const body = await response.text();
        const errorJson = JSON.parse(body);
        if (errorJson.error) {
          throw fromJsonRpcErrorResponse(errorJson);
        }
      } catch (e) {
        if (e instanceof Error && e.name !== "SyntaxError") {
          throw e;
        }
      }
      throw new Error(`Invalid response Content-Type for SSE stream for ${rpcRequest.method}. Expected 'text/event-stream'.`);
    }
    for await (const event of parseSseStream(response)) {
      yield _LegacyJsonRpcTransport._processSseEventData(event.data, rpcRequest.id);
    }
  }
  static _processSseEventData(jsonData, originalRequestId) {
    if (!jsonData.trim()) {
      throw new Error("Attempted to process empty SSE event data.");
    }
    let legacyStreamResponse;
    try {
      legacyStreamResponse = JSON.parse(jsonData);
    } catch (e) {
      throw new Error(`Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${e instanceof Error && e.message || "Unknown error"}`, { cause: e });
    }
    if (legacyStreamResponse.id !== originalRequestId) {
      throw new Error(`JSON-RPC response ID mismatch in SSE event. Expected ${originalRequestId}, got ${legacyStreamResponse.id}.`);
    }
    if ("error" in legacyStreamResponse) {
      const err = legacyStreamResponse.error;
      throw new Error(`SSE event contained an error: ${err.message} (Code: ${err.code}) Data: ${JSON.stringify(err.data || {})}`, { cause: fromJsonRpcErrorResponse(legacyStreamResponse) });
    }
    if (!("result" in legacyStreamResponse) || legacyStreamResponse.result === null) {
      throw new Error(`SSE event JSON-RPC response is missing 'result' field. Data: ${jsonData}`);
    }
    return toCoreStreamResponse({
      id: legacyStreamResponse.id,
      jsonrpc: "2.0",
      result: legacyStreamResponse.result
    });
  }
  static _parseSendMessageResult(result) {
    if (!result) {
      throw new InvalidAgentResponseError("Invalid response: v0.3 message/send result is missing.");
    }
    if (result.kind === "task") {
      return toCoreTask(result);
    }
    if (result.kind === "message") {
      return toCoreMessage(result);
    }
    throw new InvalidAgentResponseError(`Unexpected v0.3 message/send result kind: ${String(result.kind)}`);
  }
};
function taskStateFromJSON2(object) {
  switch (object) {
    case 0:
    case "TASK_STATE_UNSPECIFIED":
      return 0;
    case 1:
    case "TASK_STATE_SUBMITTED":
      return 1;
    case 2:
    case "TASK_STATE_WORKING":
      return 2;
    case 3:
    case "TASK_STATE_COMPLETED":
      return 3;
    case 4:
    case "TASK_STATE_FAILED":
      return 4;
    case 5:
    case "TASK_STATE_CANCELLED":
      return 5;
    case 6:
    case "TASK_STATE_INPUT_REQUIRED":
      return 6;
    case 7:
    case "TASK_STATE_REJECTED":
      return 7;
    case 8:
    case "TASK_STATE_AUTH_REQUIRED":
      return 8;
    case -1:
    case "UNRECOGNIZED":
    default:
      return -1;
  }
}
function taskStateToJSON2(object) {
  switch (object) {
    case 0:
      return "TASK_STATE_UNSPECIFIED";
    case 1:
      return "TASK_STATE_SUBMITTED";
    case 2:
      return "TASK_STATE_WORKING";
    case 3:
      return "TASK_STATE_COMPLETED";
    case 4:
      return "TASK_STATE_FAILED";
    case 5:
      return "TASK_STATE_CANCELLED";
    case 6:
      return "TASK_STATE_INPUT_REQUIRED";
    case 7:
      return "TASK_STATE_REJECTED";
    case 8:
      return "TASK_STATE_AUTH_REQUIRED";
    case -1:
    default:
      return "UNRECOGNIZED";
  }
}
function roleFromJSON2(object) {
  switch (object) {
    case 0:
    case "ROLE_UNSPECIFIED":
      return 0;
    case 1:
    case "ROLE_USER":
      return 1;
    case 2:
    case "ROLE_AGENT":
      return 2;
    case -1:
    case "UNRECOGNIZED":
    default:
      return -1;
  }
}
function roleToJSON2(object) {
  switch (object) {
    case 0:
      return "ROLE_UNSPECIFIED";
    case 1:
      return "ROLE_USER";
    case 2:
      return "ROLE_AGENT";
    case -1:
    default:
      return "UNRECOGNIZED";
  }
}
var SendMessageConfiguration2 = {
  fromJSON(object) {
    return {
      acceptedOutputModes: globalThis.Array.isArray(object?.acceptedOutputModes) ? object.acceptedOutputModes.map((e) => globalThis.String(e)) : globalThis.Array.isArray(object?.accepted_output_modes) ? object.accepted_output_modes.map((e) => globalThis.String(e)) : [],
      pushNotification: isSet2(object.pushNotification) ? PushNotificationConfig.fromJSON(object.pushNotification) : isSet2(object.push_notification) ? PushNotificationConfig.fromJSON(object.push_notification) : undefined,
      historyLength: isSet2(object.historyLength) ? globalThis.Number(object.historyLength) : isSet2(object.history_length) ? globalThis.Number(object.history_length) : 0,
      blocking: isSet2(object.blocking) ? globalThis.Boolean(object.blocking) : false
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.acceptedOutputModes?.length) {
      obj.acceptedOutputModes = message.acceptedOutputModes;
    }
    if (message.pushNotification !== undefined) {
      obj.pushNotification = PushNotificationConfig.toJSON(message.pushNotification);
    }
    if (message.historyLength !== 0) {
      obj.historyLength = Math.round(message.historyLength);
    }
    if (message.blocking !== false) {
      obj.blocking = message.blocking;
    }
    return obj;
  }
};
var Task2 = {
  fromJSON(object) {
    return {
      id: isSet2(object.id) ? globalThis.String(object.id) : "",
      contextId: isSet2(object.contextId) ? globalThis.String(object.contextId) : isSet2(object.context_id) ? globalThis.String(object.context_id) : "",
      status: isSet2(object.status) ? TaskStatus2.fromJSON(object.status) : undefined,
      artifacts: globalThis.Array.isArray(object?.artifacts) ? object.artifacts.map((e) => Artifact2.fromJSON(e)) : [],
      history: globalThis.Array.isArray(object?.history) ? object.history.map((e) => Message2.fromJSON(e)) : [],
      metadata: isObject2(object.metadata) ? object.metadata : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.status !== undefined) {
      obj.status = TaskStatus2.toJSON(message.status);
    }
    if (message.artifacts?.length) {
      obj.artifacts = message.artifacts.map((e) => Artifact2.toJSON(e));
    }
    if (message.history?.length) {
      obj.history = message.history.map((e) => Message2.toJSON(e));
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  }
};
var TaskStatus2 = {
  fromJSON(object) {
    return {
      state: isSet2(object.state) ? taskStateFromJSON2(object.state) : 0,
      update: isSet2(object.message) ? Message2.fromJSON(object.message) : isSet2(object.update) ? Message2.fromJSON(object.update) : undefined,
      timestamp: isSet2(object.timestamp) ? globalThis.String(object.timestamp) : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.state !== 0) {
      obj.state = taskStateToJSON2(message.state);
    }
    if (message.update !== undefined) {
      obj.message = Message2.toJSON(message.update);
    }
    if (message.timestamp !== undefined) {
      obj.timestamp = message.timestamp;
    }
    return obj;
  }
};
var Part2 = {
  fromJSON(object) {
    return {
      part: isSet2(object.text) ? { $case: "text", value: globalThis.String(object.text) } : isSet2(object.file) ? { $case: "file", value: FilePart.fromJSON(object.file) } : isSet2(object.data) ? { $case: "data", value: DataPart.fromJSON(object.data) } : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.part?.$case === "text") {
      obj.text = message.part.value;
    } else if (message.part?.$case === "file") {
      obj.file = FilePart.toJSON(message.part.value);
    } else if (message.part?.$case === "data") {
      obj.data = DataPart.toJSON(message.part.value);
    }
    return obj;
  }
};
var FilePart = {
  fromJSON(object) {
    return {
      file: isSet2(object.fileWithUri) ? { $case: "fileWithUri", value: globalThis.String(object.fileWithUri) } : isSet2(object.file_with_uri) ? { $case: "fileWithUri", value: globalThis.String(object.file_with_uri) } : isSet2(object.fileWithBytes) ? { $case: "fileWithBytes", value: Buffer.from(bytesFromBase642(object.fileWithBytes)) } : isSet2(object.file_with_bytes) ? { $case: "fileWithBytes", value: Buffer.from(bytesFromBase642(object.file_with_bytes)) } : undefined,
      mimeType: isSet2(object.mimeType) ? globalThis.String(object.mimeType) : isSet2(object.mime_type) ? globalThis.String(object.mime_type) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.file?.$case === "fileWithUri") {
      obj.fileWithUri = message.file.value;
    } else if (message.file?.$case === "fileWithBytes") {
      obj.fileWithBytes = base64FromBytes2(message.file.value);
    }
    if (message.mimeType !== "") {
      obj.mimeType = message.mimeType;
    }
    return obj;
  }
};
var DataPart = {
  fromJSON(object) {
    return { data: isObject2(object.data) ? object.data : undefined };
  },
  toJSON(message) {
    const obj = {};
    if (message.data !== undefined) {
      obj.data = message.data;
    }
    return obj;
  }
};
var Message2 = {
  fromJSON(object) {
    return {
      messageId: isSet2(object.messageId) ? globalThis.String(object.messageId) : isSet2(object.message_id) ? globalThis.String(object.message_id) : "",
      contextId: isSet2(object.contextId) ? globalThis.String(object.contextId) : isSet2(object.context_id) ? globalThis.String(object.context_id) : "",
      taskId: isSet2(object.taskId) ? globalThis.String(object.taskId) : isSet2(object.task_id) ? globalThis.String(object.task_id) : "",
      role: isSet2(object.role) ? roleFromJSON2(object.role) : 0,
      content: globalThis.Array.isArray(object?.content) ? object.content.map((e) => Part2.fromJSON(e)) : [],
      metadata: isObject2(object.metadata) ? object.metadata : undefined,
      extensions: globalThis.Array.isArray(object?.extensions) ? object.extensions.map((e) => globalThis.String(e)) : []
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.messageId !== "") {
      obj.messageId = message.messageId;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.role !== 0) {
      obj.role = roleToJSON2(message.role);
    }
    if (message.content?.length) {
      obj.content = message.content.map((e) => Part2.toJSON(e));
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    if (message.extensions?.length) {
      obj.extensions = message.extensions;
    }
    return obj;
  }
};
var Artifact2 = {
  fromJSON(object) {
    return {
      artifactId: isSet2(object.artifactId) ? globalThis.String(object.artifactId) : isSet2(object.artifact_id) ? globalThis.String(object.artifact_id) : "",
      name: isSet2(object.name) ? globalThis.String(object.name) : "",
      description: isSet2(object.description) ? globalThis.String(object.description) : "",
      parts: globalThis.Array.isArray(object?.parts) ? object.parts.map((e) => Part2.fromJSON(e)) : [],
      metadata: isObject2(object.metadata) ? object.metadata : undefined,
      extensions: globalThis.Array.isArray(object?.extensions) ? object.extensions.map((e) => globalThis.String(e)) : []
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.artifactId !== "") {
      obj.artifactId = message.artifactId;
    }
    if (message.name !== "") {
      obj.name = message.name;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.parts?.length) {
      obj.parts = message.parts.map((e) => Part2.toJSON(e));
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    if (message.extensions?.length) {
      obj.extensions = message.extensions;
    }
    return obj;
  }
};
var TaskStatusUpdateEvent2 = {
  fromJSON(object) {
    return {
      taskId: isSet2(object.taskId) ? globalThis.String(object.taskId) : isSet2(object.task_id) ? globalThis.String(object.task_id) : "",
      contextId: isSet2(object.contextId) ? globalThis.String(object.contextId) : isSet2(object.context_id) ? globalThis.String(object.context_id) : "",
      status: isSet2(object.status) ? TaskStatus2.fromJSON(object.status) : undefined,
      final: isSet2(object.final) ? globalThis.Boolean(object.final) : false,
      metadata: isObject2(object.metadata) ? object.metadata : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.status !== undefined) {
      obj.status = TaskStatus2.toJSON(message.status);
    }
    if (message.final !== false) {
      obj.final = message.final;
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  }
};
var TaskArtifactUpdateEvent2 = {
  fromJSON(object) {
    return {
      taskId: isSet2(object.taskId) ? globalThis.String(object.taskId) : isSet2(object.task_id) ? globalThis.String(object.task_id) : "",
      contextId: isSet2(object.contextId) ? globalThis.String(object.contextId) : isSet2(object.context_id) ? globalThis.String(object.context_id) : "",
      artifact: isSet2(object.artifact) ? Artifact2.fromJSON(object.artifact) : undefined,
      append: isSet2(object.append) ? globalThis.Boolean(object.append) : false,
      lastChunk: isSet2(object.lastChunk) ? globalThis.Boolean(object.lastChunk) : isSet2(object.last_chunk) ? globalThis.Boolean(object.last_chunk) : false,
      metadata: isObject2(object.metadata) ? object.metadata : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.taskId !== "") {
      obj.taskId = message.taskId;
    }
    if (message.contextId !== "") {
      obj.contextId = message.contextId;
    }
    if (message.artifact !== undefined) {
      obj.artifact = Artifact2.toJSON(message.artifact);
    }
    if (message.append !== false) {
      obj.append = message.append;
    }
    if (message.lastChunk !== false) {
      obj.lastChunk = message.lastChunk;
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  }
};
var PushNotificationConfig = {
  fromJSON(object) {
    return {
      id: isSet2(object.id) ? globalThis.String(object.id) : "",
      url: isSet2(object.url) ? globalThis.String(object.url) : "",
      token: isSet2(object.token) ? globalThis.String(object.token) : "",
      authentication: isSet2(object.authentication) ? AuthenticationInfo2.fromJSON(object.authentication) : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.url !== "") {
      obj.url = message.url;
    }
    if (message.token !== "") {
      obj.token = message.token;
    }
    if (message.authentication !== undefined) {
      obj.authentication = AuthenticationInfo2.toJSON(message.authentication);
    }
    return obj;
  }
};
var AuthenticationInfo2 = {
  fromJSON(object) {
    return {
      schemes: globalThis.Array.isArray(object?.schemes) ? object.schemes.map((e) => globalThis.String(e)) : [],
      credentials: isSet2(object.credentials) ? globalThis.String(object.credentials) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.schemes?.length) {
      obj.schemes = message.schemes;
    }
    if (message.credentials !== "") {
      obj.credentials = message.credentials;
    }
    return obj;
  }
};
var AgentInterface2 = {
  fromJSON(object) {
    return {
      url: isSet2(object.url) ? globalThis.String(object.url) : "",
      transport: isSet2(object.transport) ? globalThis.String(object.transport) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.url !== "") {
      obj.url = message.url;
    }
    if (message.transport !== "") {
      obj.transport = message.transport;
    }
    return obj;
  }
};
var AgentCard2 = {
  fromJSON(object) {
    return {
      protocolVersion: isSet2(object.protocolVersion) ? globalThis.String(object.protocolVersion) : isSet2(object.protocol_version) ? globalThis.String(object.protocol_version) : "",
      name: isSet2(object.name) ? globalThis.String(object.name) : "",
      description: isSet2(object.description) ? globalThis.String(object.description) : "",
      url: isSet2(object.url) ? globalThis.String(object.url) : "",
      preferredTransport: isSet2(object.preferredTransport) ? globalThis.String(object.preferredTransport) : isSet2(object.preferred_transport) ? globalThis.String(object.preferred_transport) : "",
      additionalInterfaces: globalThis.Array.isArray(object?.additionalInterfaces) ? object.additionalInterfaces.map((e) => AgentInterface2.fromJSON(e)) : globalThis.Array.isArray(object?.additional_interfaces) ? object.additional_interfaces.map((e) => AgentInterface2.fromJSON(e)) : [],
      provider: isSet2(object.provider) ? AgentProvider2.fromJSON(object.provider) : undefined,
      version: isSet2(object.version) ? globalThis.String(object.version) : "",
      documentationUrl: isSet2(object.documentationUrl) ? globalThis.String(object.documentationUrl) : isSet2(object.documentation_url) ? globalThis.String(object.documentation_url) : "",
      capabilities: isSet2(object.capabilities) ? AgentCapabilities2.fromJSON(object.capabilities) : undefined,
      securitySchemes: isObject2(object.securitySchemes) ? globalThis.Object.entries(object.securitySchemes).reduce((acc, [key, value]) => {
        acc[key] = SecurityScheme2.fromJSON(value);
        return acc;
      }, {}) : isObject2(object.security_schemes) ? globalThis.Object.entries(object.security_schemes).reduce((acc, [key, value]) => {
        acc[key] = SecurityScheme2.fromJSON(value);
        return acc;
      }, {}) : {},
      security: globalThis.Array.isArray(object?.security) ? object.security.map((e) => Security.fromJSON(e)) : [],
      defaultInputModes: globalThis.Array.isArray(object?.defaultInputModes) ? object.defaultInputModes.map((e) => globalThis.String(e)) : globalThis.Array.isArray(object?.default_input_modes) ? object.default_input_modes.map((e) => globalThis.String(e)) : [],
      defaultOutputModes: globalThis.Array.isArray(object?.defaultOutputModes) ? object.defaultOutputModes.map((e) => globalThis.String(e)) : globalThis.Array.isArray(object?.default_output_modes) ? object.default_output_modes.map((e) => globalThis.String(e)) : [],
      skills: globalThis.Array.isArray(object?.skills) ? object.skills.map((e) => AgentSkill2.fromJSON(e)) : [],
      supportsAuthenticatedExtendedCard: isSet2(object.supportsAuthenticatedExtendedCard) ? globalThis.Boolean(object.supportsAuthenticatedExtendedCard) : isSet2(object.supports_authenticated_extended_card) ? globalThis.Boolean(object.supports_authenticated_extended_card) : false,
      signatures: globalThis.Array.isArray(object?.signatures) ? object.signatures.map((e) => AgentCardSignature3.fromJSON(e)) : []
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.protocolVersion !== "") {
      obj.protocolVersion = message.protocolVersion;
    }
    if (message.name !== "") {
      obj.name = message.name;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.url !== "") {
      obj.url = message.url;
    }
    if (message.preferredTransport !== "") {
      obj.preferredTransport = message.preferredTransport;
    }
    if (message.additionalInterfaces?.length) {
      obj.additionalInterfaces = message.additionalInterfaces.map((e) => AgentInterface2.toJSON(e));
    }
    if (message.provider !== undefined) {
      obj.provider = AgentProvider2.toJSON(message.provider);
    }
    if (message.version !== "") {
      obj.version = message.version;
    }
    if (message.documentationUrl !== "") {
      obj.documentationUrl = message.documentationUrl;
    }
    if (message.capabilities !== undefined) {
      obj.capabilities = AgentCapabilities2.toJSON(message.capabilities);
    }
    if (message.securitySchemes) {
      const entries = globalThis.Object.entries(message.securitySchemes);
      if (entries.length > 0) {
        obj.securitySchemes = {};
        entries.forEach(([k, v]) => {
          obj.securitySchemes[k] = SecurityScheme2.toJSON(v);
        });
      }
    }
    if (message.security?.length) {
      obj.security = message.security.map((e) => Security.toJSON(e));
    }
    if (message.defaultInputModes?.length) {
      obj.defaultInputModes = message.defaultInputModes;
    }
    if (message.defaultOutputModes?.length) {
      obj.defaultOutputModes = message.defaultOutputModes;
    }
    if (message.skills?.length) {
      obj.skills = message.skills.map((e) => AgentSkill2.toJSON(e));
    }
    if (message.supportsAuthenticatedExtendedCard !== false) {
      obj.supportsAuthenticatedExtendedCard = message.supportsAuthenticatedExtendedCard;
    }
    if (message.signatures?.length) {
      obj.signatures = message.signatures.map((e) => AgentCardSignature3.toJSON(e));
    }
    return obj;
  }
};
var AgentProvider2 = {
  fromJSON(object) {
    return {
      url: isSet2(object.url) ? globalThis.String(object.url) : "",
      organization: isSet2(object.organization) ? globalThis.String(object.organization) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.url !== "") {
      obj.url = message.url;
    }
    if (message.organization !== "") {
      obj.organization = message.organization;
    }
    return obj;
  }
};
var AgentCapabilities2 = {
  fromJSON(object) {
    return {
      streaming: isSet2(object.streaming) ? globalThis.Boolean(object.streaming) : false,
      pushNotifications: isSet2(object.pushNotifications) ? globalThis.Boolean(object.pushNotifications) : isSet2(object.push_notifications) ? globalThis.Boolean(object.push_notifications) : false,
      extensions: globalThis.Array.isArray(object?.extensions) ? object.extensions.map((e) => AgentExtension2.fromJSON(e)) : []
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.streaming !== false) {
      obj.streaming = message.streaming;
    }
    if (message.pushNotifications !== false) {
      obj.pushNotifications = message.pushNotifications;
    }
    if (message.extensions?.length) {
      obj.extensions = message.extensions.map((e) => AgentExtension2.toJSON(e));
    }
    return obj;
  }
};
var AgentExtension2 = {
  fromJSON(object) {
    return {
      uri: isSet2(object.uri) ? globalThis.String(object.uri) : "",
      description: isSet2(object.description) ? globalThis.String(object.description) : "",
      required: isSet2(object.required) ? globalThis.Boolean(object.required) : false,
      params: isObject2(object.params) ? object.params : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.uri !== "") {
      obj.uri = message.uri;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.required !== false) {
      obj.required = message.required;
    }
    if (message.params !== undefined) {
      obj.params = message.params;
    }
    return obj;
  }
};
var AgentSkill2 = {
  fromJSON(object) {
    return {
      id: isSet2(object.id) ? globalThis.String(object.id) : "",
      name: isSet2(object.name) ? globalThis.String(object.name) : "",
      description: isSet2(object.description) ? globalThis.String(object.description) : "",
      tags: globalThis.Array.isArray(object?.tags) ? object.tags.map((e) => globalThis.String(e)) : [],
      examples: globalThis.Array.isArray(object?.examples) ? object.examples.map((e) => globalThis.String(e)) : [],
      inputModes: globalThis.Array.isArray(object?.inputModes) ? object.inputModes.map((e) => globalThis.String(e)) : globalThis.Array.isArray(object?.input_modes) ? object.input_modes.map((e) => globalThis.String(e)) : [],
      outputModes: globalThis.Array.isArray(object?.outputModes) ? object.outputModes.map((e) => globalThis.String(e)) : globalThis.Array.isArray(object?.output_modes) ? object.output_modes.map((e) => globalThis.String(e)) : [],
      security: globalThis.Array.isArray(object?.security) ? object.security.map((e) => Security.fromJSON(e)) : []
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.id !== "") {
      obj.id = message.id;
    }
    if (message.name !== "") {
      obj.name = message.name;
    }
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.tags?.length) {
      obj.tags = message.tags;
    }
    if (message.examples?.length) {
      obj.examples = message.examples;
    }
    if (message.inputModes?.length) {
      obj.inputModes = message.inputModes;
    }
    if (message.outputModes?.length) {
      obj.outputModes = message.outputModes;
    }
    if (message.security?.length) {
      obj.security = message.security.map((e) => Security.toJSON(e));
    }
    return obj;
  }
};
var AgentCardSignature3 = {
  fromJSON(object) {
    return {
      protected: isSet2(object.protected) ? globalThis.String(object.protected) : "",
      signature: isSet2(object.signature) ? globalThis.String(object.signature) : "",
      header: isObject2(object.header) ? object.header : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.protected !== "") {
      obj.protected = message.protected;
    }
    if (message.signature !== "") {
      obj.signature = message.signature;
    }
    if (message.header !== undefined) {
      obj.header = message.header;
    }
    return obj;
  }
};
var TaskPushNotificationConfig2 = {
  fromJSON(object) {
    return {
      name: isSet2(object.name) ? globalThis.String(object.name) : "",
      pushNotificationConfig: isSet2(object.pushNotificationConfig) ? PushNotificationConfig.fromJSON(object.pushNotificationConfig) : isSet2(object.push_notification_config) ? PushNotificationConfig.fromJSON(object.push_notification_config) : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.name !== "") {
      obj.name = message.name;
    }
    if (message.pushNotificationConfig !== undefined) {
      obj.pushNotificationConfig = PushNotificationConfig.toJSON(message.pushNotificationConfig);
    }
    return obj;
  }
};
var StringList2 = {
  fromJSON(object) {
    return { list: globalThis.Array.isArray(object?.list) ? object.list.map((e) => globalThis.String(e)) : [] };
  },
  toJSON(message) {
    const obj = {};
    if (message.list?.length) {
      obj.list = message.list;
    }
    return obj;
  }
};
var Security = {
  fromJSON(object) {
    return {
      schemes: isObject2(object.schemes) ? globalThis.Object.entries(object.schemes).reduce((acc, [key, value]) => {
        acc[key] = StringList2.fromJSON(value);
        return acc;
      }, {}) : {}
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.schemes) {
      const entries = globalThis.Object.entries(message.schemes);
      if (entries.length > 0) {
        obj.schemes = {};
        entries.forEach(([k, v]) => {
          obj.schemes[k] = StringList2.toJSON(v);
        });
      }
    }
    return obj;
  }
};
var SecurityScheme2 = {
  fromJSON(object) {
    return {
      scheme: isSet2(object.apiKeySecurityScheme) ? { $case: "apiKeySecurityScheme", value: APIKeySecurityScheme2.fromJSON(object.apiKeySecurityScheme) } : isSet2(object.api_key_security_scheme) ? { $case: "apiKeySecurityScheme", value: APIKeySecurityScheme2.fromJSON(object.api_key_security_scheme) } : isSet2(object.httpAuthSecurityScheme) ? { $case: "httpAuthSecurityScheme", value: HTTPAuthSecurityScheme2.fromJSON(object.httpAuthSecurityScheme) } : isSet2(object.http_auth_security_scheme) ? { $case: "httpAuthSecurityScheme", value: HTTPAuthSecurityScheme2.fromJSON(object.http_auth_security_scheme) } : isSet2(object.oauth2SecurityScheme) ? { $case: "oauth2SecurityScheme", value: OAuth2SecurityScheme2.fromJSON(object.oauth2SecurityScheme) } : isSet2(object.oauth2_security_scheme) ? { $case: "oauth2SecurityScheme", value: OAuth2SecurityScheme2.fromJSON(object.oauth2_security_scheme) } : isSet2(object.openIdConnectSecurityScheme) ? {
        $case: "openIdConnectSecurityScheme",
        value: OpenIdConnectSecurityScheme2.fromJSON(object.openIdConnectSecurityScheme)
      } : isSet2(object.open_id_connect_security_scheme) ? {
        $case: "openIdConnectSecurityScheme",
        value: OpenIdConnectSecurityScheme2.fromJSON(object.open_id_connect_security_scheme)
      } : isSet2(object.mtlsSecurityScheme) ? { $case: "mtlsSecurityScheme", value: MutualTlsSecurityScheme2.fromJSON(object.mtlsSecurityScheme) } : isSet2(object.mtls_security_scheme) ? { $case: "mtlsSecurityScheme", value: MutualTlsSecurityScheme2.fromJSON(object.mtls_security_scheme) } : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.scheme?.$case === "apiKeySecurityScheme") {
      obj.apiKeySecurityScheme = APIKeySecurityScheme2.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "httpAuthSecurityScheme") {
      obj.httpAuthSecurityScheme = HTTPAuthSecurityScheme2.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "oauth2SecurityScheme") {
      obj.oauth2SecurityScheme = OAuth2SecurityScheme2.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "openIdConnectSecurityScheme") {
      obj.openIdConnectSecurityScheme = OpenIdConnectSecurityScheme2.toJSON(message.scheme.value);
    } else if (message.scheme?.$case === "mtlsSecurityScheme") {
      obj.mtlsSecurityScheme = MutualTlsSecurityScheme2.toJSON(message.scheme.value);
    }
    return obj;
  }
};
var APIKeySecurityScheme2 = {
  fromJSON(object) {
    return {
      description: isSet2(object.description) ? globalThis.String(object.description) : "",
      location: isSet2(object.location) ? globalThis.String(object.location) : "",
      name: isSet2(object.name) ? globalThis.String(object.name) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.location !== "") {
      obj.location = message.location;
    }
    if (message.name !== "") {
      obj.name = message.name;
    }
    return obj;
  }
};
var HTTPAuthSecurityScheme2 = {
  fromJSON(object) {
    return {
      description: isSet2(object.description) ? globalThis.String(object.description) : "",
      scheme: isSet2(object.scheme) ? globalThis.String(object.scheme) : "",
      bearerFormat: isSet2(object.bearerFormat) ? globalThis.String(object.bearerFormat) : isSet2(object.bearer_format) ? globalThis.String(object.bearer_format) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.scheme !== "") {
      obj.scheme = message.scheme;
    }
    if (message.bearerFormat !== "") {
      obj.bearerFormat = message.bearerFormat;
    }
    return obj;
  }
};
var OAuth2SecurityScheme2 = {
  fromJSON(object) {
    return {
      description: isSet2(object.description) ? globalThis.String(object.description) : "",
      flows: isSet2(object.flows) ? OAuthFlows2.fromJSON(object.flows) : undefined,
      oauth2MetadataUrl: isSet2(object.oauth2MetadataUrl) ? globalThis.String(object.oauth2MetadataUrl) : isSet2(object.oauth2_metadata_url) ? globalThis.String(object.oauth2_metadata_url) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.flows !== undefined) {
      obj.flows = OAuthFlows2.toJSON(message.flows);
    }
    if (message.oauth2MetadataUrl !== "") {
      obj.oauth2MetadataUrl = message.oauth2MetadataUrl;
    }
    return obj;
  }
};
var OpenIdConnectSecurityScheme2 = {
  fromJSON(object) {
    return {
      description: isSet2(object.description) ? globalThis.String(object.description) : "",
      openIdConnectUrl: isSet2(object.openIdConnectUrl) ? globalThis.String(object.openIdConnectUrl) : isSet2(object.open_id_connect_url) ? globalThis.String(object.open_id_connect_url) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    if (message.openIdConnectUrl !== "") {
      obj.openIdConnectUrl = message.openIdConnectUrl;
    }
    return obj;
  }
};
var MutualTlsSecurityScheme2 = {
  fromJSON(object) {
    return { description: isSet2(object.description) ? globalThis.String(object.description) : "" };
  },
  toJSON(message) {
    const obj = {};
    if (message.description !== "") {
      obj.description = message.description;
    }
    return obj;
  }
};
var OAuthFlows2 = {
  fromJSON(object) {
    return {
      flow: isSet2(object.authorizationCode) ? { $case: "authorizationCode", value: AuthorizationCodeOAuthFlow2.fromJSON(object.authorizationCode) } : isSet2(object.authorization_code) ? { $case: "authorizationCode", value: AuthorizationCodeOAuthFlow2.fromJSON(object.authorization_code) } : isSet2(object.clientCredentials) ? { $case: "clientCredentials", value: ClientCredentialsOAuthFlow2.fromJSON(object.clientCredentials) } : isSet2(object.client_credentials) ? { $case: "clientCredentials", value: ClientCredentialsOAuthFlow2.fromJSON(object.client_credentials) } : isSet2(object.implicit) ? { $case: "implicit", value: ImplicitOAuthFlow2.fromJSON(object.implicit) } : isSet2(object.password) ? { $case: "password", value: PasswordOAuthFlow2.fromJSON(object.password) } : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.flow?.$case === "authorizationCode") {
      obj.authorizationCode = AuthorizationCodeOAuthFlow2.toJSON(message.flow.value);
    } else if (message.flow?.$case === "clientCredentials") {
      obj.clientCredentials = ClientCredentialsOAuthFlow2.toJSON(message.flow.value);
    } else if (message.flow?.$case === "implicit") {
      obj.implicit = ImplicitOAuthFlow2.toJSON(message.flow.value);
    } else if (message.flow?.$case === "password") {
      obj.password = PasswordOAuthFlow2.toJSON(message.flow.value);
    }
    return obj;
  }
};
var AuthorizationCodeOAuthFlow2 = {
  fromJSON(object) {
    return {
      authorizationUrl: isSet2(object.authorizationUrl) ? globalThis.String(object.authorizationUrl) : isSet2(object.authorization_url) ? globalThis.String(object.authorization_url) : "",
      tokenUrl: isSet2(object.tokenUrl) ? globalThis.String(object.tokenUrl) : isSet2(object.token_url) ? globalThis.String(object.token_url) : "",
      refreshUrl: isSet2(object.refreshUrl) ? globalThis.String(object.refreshUrl) : isSet2(object.refresh_url) ? globalThis.String(object.refresh_url) : "",
      scopes: isObject2(object.scopes) ? globalThis.Object.entries(object.scopes).reduce((acc, [key, value]) => {
        acc[key] = globalThis.String(value);
        return acc;
      }, {}) : {}
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.authorizationUrl !== "") {
      obj.authorizationUrl = message.authorizationUrl;
    }
    if (message.tokenUrl !== "") {
      obj.tokenUrl = message.tokenUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes);
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  }
};
var ClientCredentialsOAuthFlow2 = {
  fromJSON(object) {
    return {
      tokenUrl: isSet2(object.tokenUrl) ? globalThis.String(object.tokenUrl) : isSet2(object.token_url) ? globalThis.String(object.token_url) : "",
      refreshUrl: isSet2(object.refreshUrl) ? globalThis.String(object.refreshUrl) : isSet2(object.refresh_url) ? globalThis.String(object.refresh_url) : "",
      scopes: isObject2(object.scopes) ? globalThis.Object.entries(object.scopes).reduce((acc, [key, value]) => {
        acc[key] = globalThis.String(value);
        return acc;
      }, {}) : {}
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tokenUrl !== "") {
      obj.tokenUrl = message.tokenUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes);
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  }
};
var ImplicitOAuthFlow2 = {
  fromJSON(object) {
    return {
      authorizationUrl: isSet2(object.authorizationUrl) ? globalThis.String(object.authorizationUrl) : isSet2(object.authorization_url) ? globalThis.String(object.authorization_url) : "",
      refreshUrl: isSet2(object.refreshUrl) ? globalThis.String(object.refreshUrl) : isSet2(object.refresh_url) ? globalThis.String(object.refresh_url) : "",
      scopes: isObject2(object.scopes) ? globalThis.Object.entries(object.scopes).reduce((acc, [key, value]) => {
        acc[key] = globalThis.String(value);
        return acc;
      }, {}) : {}
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.authorizationUrl !== "") {
      obj.authorizationUrl = message.authorizationUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes);
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  }
};
var PasswordOAuthFlow2 = {
  fromJSON(object) {
    return {
      tokenUrl: isSet2(object.tokenUrl) ? globalThis.String(object.tokenUrl) : isSet2(object.token_url) ? globalThis.String(object.token_url) : "",
      refreshUrl: isSet2(object.refreshUrl) ? globalThis.String(object.refreshUrl) : isSet2(object.refresh_url) ? globalThis.String(object.refresh_url) : "",
      scopes: isObject2(object.scopes) ? globalThis.Object.entries(object.scopes).reduce((acc, [key, value]) => {
        acc[key] = globalThis.String(value);
        return acc;
      }, {}) : {}
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.tokenUrl !== "") {
      obj.tokenUrl = message.tokenUrl;
    }
    if (message.refreshUrl !== "") {
      obj.refreshUrl = message.refreshUrl;
    }
    if (message.scopes) {
      const entries = globalThis.Object.entries(message.scopes);
      if (entries.length > 0) {
        obj.scopes = {};
        entries.forEach(([k, v]) => {
          obj.scopes[k] = v;
        });
      }
    }
    return obj;
  }
};
var SendMessageRequest2 = {
  fromJSON(object) {
    return {
      request: isSet2(object.message) ? Message2.fromJSON(object.message) : isSet2(object.request) ? Message2.fromJSON(object.request) : undefined,
      configuration: isSet2(object.configuration) ? SendMessageConfiguration2.fromJSON(object.configuration) : undefined,
      metadata: isObject2(object.metadata) ? object.metadata : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.request !== undefined) {
      obj.message = Message2.toJSON(message.request);
    }
    if (message.configuration !== undefined) {
      obj.configuration = SendMessageConfiguration2.toJSON(message.configuration);
    }
    if (message.metadata !== undefined) {
      obj.metadata = message.metadata;
    }
    return obj;
  }
};
var SendMessageResponse2 = {
  fromJSON(object) {
    return {
      payload: isSet2(object.task) ? { $case: "task", value: Task2.fromJSON(object.task) } : isSet2(object.message) ? { $case: "msg", value: Message2.fromJSON(object.message) } : isSet2(object.msg) ? { $case: "msg", value: Message2.fromJSON(object.msg) } : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.payload?.$case === "task") {
      obj.task = Task2.toJSON(message.payload.value);
    } else if (message.payload?.$case === "msg") {
      obj.message = Message2.toJSON(message.payload.value);
    }
    return obj;
  }
};
var StreamResponse2 = {
  fromJSON(object) {
    return {
      payload: isSet2(object.task) ? { $case: "task", value: Task2.fromJSON(object.task) } : isSet2(object.message) ? { $case: "msg", value: Message2.fromJSON(object.message) } : isSet2(object.msg) ? { $case: "msg", value: Message2.fromJSON(object.msg) } : isSet2(object.statusUpdate) ? { $case: "statusUpdate", value: TaskStatusUpdateEvent2.fromJSON(object.statusUpdate) } : isSet2(object.status_update) ? { $case: "statusUpdate", value: TaskStatusUpdateEvent2.fromJSON(object.status_update) } : isSet2(object.artifactUpdate) ? { $case: "artifactUpdate", value: TaskArtifactUpdateEvent2.fromJSON(object.artifactUpdate) } : isSet2(object.artifact_update) ? { $case: "artifactUpdate", value: TaskArtifactUpdateEvent2.fromJSON(object.artifact_update) } : undefined
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.payload?.$case === "task") {
      obj.task = Task2.toJSON(message.payload.value);
    } else if (message.payload?.$case === "msg") {
      obj.message = Message2.toJSON(message.payload.value);
    } else if (message.payload?.$case === "statusUpdate") {
      obj.statusUpdate = TaskStatusUpdateEvent2.toJSON(message.payload.value);
    } else if (message.payload?.$case === "artifactUpdate") {
      obj.artifactUpdate = TaskArtifactUpdateEvent2.toJSON(message.payload.value);
    }
    return obj;
  }
};
var ListTaskPushNotificationConfigResponse = {
  fromJSON(object) {
    return {
      configs: globalThis.Array.isArray(object?.configs) ? object.configs.map((e) => TaskPushNotificationConfig2.fromJSON(e)) : [],
      nextPageToken: isSet2(object.nextPageToken) ? globalThis.String(object.nextPageToken) : isSet2(object.next_page_token) ? globalThis.String(object.next_page_token) : ""
    };
  },
  toJSON(message) {
    const obj = {};
    if (message.configs?.length) {
      obj.configs = message.configs.map((e) => TaskPushNotificationConfig2.toJSON(e));
    }
    if (message.nextPageToken !== "") {
      obj.nextPageToken = message.nextPageToken;
    }
    return obj;
  }
};
function bytesFromBase642(b64) {
  return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
}
function base64FromBytes2(arr) {
  return globalThis.Buffer.from(arr).toString("base64");
}
function isObject2(value) {
  return typeof value === "object" && value !== null;
}
function isSet2(value) {
  return value !== null && value !== undefined;
}
var CONFIG_REGEX = /^tasks\/([^/]+)\/pushNotificationConfigs\/([^/]+)$/;
var TASK_ONLY_REGEX = /^tasks\/([^/]+)(?:\/|$)/;
var extractTaskId = (name) => {
  const match = name.match(TASK_ONLY_REGEX);
  if (!match) {
    throw A2AError2.invalidParams(`Invalid or missing task ID in: "${name}"`);
  }
  return match[1];
};
var generateTaskName = (taskId) => {
  return `tasks/${taskId}`;
};
var extractTaskAndPushNotificationConfigId = (name) => {
  const match = name.match(CONFIG_REGEX);
  if (!match) {
    throw A2AError2.invalidParams(`Invalid or missing config ID in: "${name}"`);
  }
  return { taskId: match[1], configId: match[2] };
};
var generatePushNotificationConfigName = (taskId, configId) => {
  return `tasks/${taskId}/pushNotificationConfigs/${configId}`;
};
var FromProto = class _FromProto {
  static taskQueryParams(request) {
    return {
      id: extractTaskId(request.name),
      historyLength: request.historyLength
    };
  }
  static taskIdParams(request) {
    return {
      id: extractTaskId(request.name)
    };
  }
  static getTaskPushNotificationConfigParams(request) {
    const { taskId, configId } = extractTaskAndPushNotificationConfigId(request.name);
    return {
      id: taskId,
      pushNotificationConfigId: configId
    };
  }
  static listTaskPushNotificationConfigParams(request) {
    return {
      id: extractTaskId(request.parent)
    };
  }
  static createTaskPushNotificationConfig(request) {
    if (!request.config?.pushNotificationConfig) {
      throw A2AError2.invalidParams("Request must include a `config` object with a `pushNotificationConfig`");
    }
    return {
      taskId: extractTaskId(request.parent),
      pushNotificationConfig: _FromProto.pushNotificationConfig(request.config.pushNotificationConfig)
    };
  }
  static deleteTaskPushNotificationConfigParams(request) {
    const { taskId, configId } = extractTaskAndPushNotificationConfigId(request.name);
    return {
      id: taskId,
      pushNotificationConfigId: configId
    };
  }
  static message(message) {
    if (!message) {
      return;
    }
    return {
      kind: "message",
      messageId: message.messageId,
      parts: message.content.map((p) => _FromProto.part(p)),
      contextId: message.contextId || undefined,
      taskId: message.taskId || undefined,
      role: _FromProto.role(message.role),
      metadata: message.metadata,
      extensions: message.extensions
    };
  }
  static role(role) {
    switch (role) {
      case 2:
        return "agent";
      case 1:
        return "user";
      default:
        throw A2AError2.invalidParams(`Invalid role: ${role}`);
    }
  }
  static messageSendConfiguration(configuration) {
    if (!configuration) {
      return;
    }
    return {
      blocking: configuration.blocking,
      acceptedOutputModes: configuration.acceptedOutputModes,
      pushNotificationConfig: _FromProto.pushNotificationConfig(configuration.pushNotification)
    };
  }
  static pushNotificationConfig(config) {
    if (!config) {
      return;
    }
    return {
      id: config.id,
      url: config.url,
      token: config.token || undefined,
      authentication: _FromProto.pushNotificationAuthenticationInfo(config.authentication)
    };
  }
  static pushNotificationAuthenticationInfo(authInfo) {
    if (!authInfo) {
      return;
    }
    return {
      schemes: authInfo.schemes,
      credentials: authInfo.credentials
    };
  }
  static part(part) {
    if (part.part?.$case === "text") {
      return {
        kind: "text",
        text: part.part.value
      };
    }
    if (part.part?.$case === "file") {
      const filePart = part.part.value;
      if (filePart.file?.$case === "fileWithUri") {
        return {
          kind: "file",
          file: {
            uri: filePart.file.value,
            mimeType: filePart.mimeType
          }
        };
      } else if (filePart.file?.$case === "fileWithBytes") {
        return {
          kind: "file",
          file: {
            bytes: Buffer.from(filePart.file.value).toString("base64"),
            mimeType: filePart.mimeType
          }
        };
      }
      throw A2AError2.invalidParams("Invalid file part type");
    }
    if (part.part?.$case === "data") {
      return {
        kind: "data",
        data: part.part.value.data ?? {}
      };
    }
    throw A2AError2.invalidParams("Invalid part type");
  }
  static messageSendParams(request) {
    if (!request.request) {
      throw A2AError2.invalidParams("SendMessageRequest missing message");
    }
    return {
      message: _FromProto.message(request.request),
      configuration: _FromProto.messageSendConfiguration(request.configuration),
      metadata: request.metadata
    };
  }
  static sendMessageResult(response) {
    if (response.payload?.$case === "task") {
      return _FromProto.task(response.payload.value);
    } else if (response.payload?.$case === "msg") {
      return _FromProto.message(response.payload.value);
    }
    throw A2AError2.invalidParams("Invalid SendMessageResponse: missing result");
  }
  static task(task) {
    if (!task.status) {
      throw A2AError2.internalError("Task missing status");
    }
    return {
      kind: "task",
      id: task.id,
      status: _FromProto.taskStatus(task.status),
      contextId: task.contextId,
      artifacts: task.artifacts?.map((a) => _FromProto.artifact(a)),
      history: task.history?.map((h) => _FromProto.message(h)),
      metadata: task.metadata
    };
  }
  static taskStatus(status) {
    return {
      message: _FromProto.message(status.update),
      state: _FromProto.taskState(status.state),
      timestamp: status.timestamp
    };
  }
  static taskState(state) {
    switch (state) {
      case 1:
        return "submitted";
      case 2:
        return "working";
      case 6:
        return "input-required";
      case 3:
        return "completed";
      case 5:
        return "canceled";
      case 4:
        return "failed";
      case 7:
        return "rejected";
      case 8:
        return "auth-required";
      case 0:
        return "unknown";
      default:
        throw A2AError2.invalidParams(`Invalid task state: ${state}`);
    }
  }
  static artifact(artifact) {
    return {
      artifactId: artifact.artifactId,
      name: artifact.name || undefined,
      description: artifact.description || undefined,
      parts: artifact.parts.map((p) => _FromProto.part(p)),
      metadata: artifact.metadata
    };
  }
  static taskPushNotificationConfig(request) {
    if (!request.pushNotificationConfig) {
      throw A2AError2.invalidParams("TaskPushNotificationConfig missing pushNotificationConfig");
    }
    return {
      taskId: extractTaskId(request.name),
      pushNotificationConfig: _FromProto.pushNotificationConfig(request.pushNotificationConfig)
    };
  }
  static listTaskPushNotificationConfig(request) {
    return request.configs.map((c) => _FromProto.taskPushNotificationConfig(c));
  }
  static agentCard(agentCard) {
    return {
      additionalInterfaces: agentCard.additionalInterfaces?.map((i) => _FromProto.agentInterface(i)),
      capabilities: agentCard.capabilities ? _FromProto.agentCapabilities(agentCard.capabilities) : {},
      defaultInputModes: agentCard.defaultInputModes,
      defaultOutputModes: agentCard.defaultOutputModes,
      description: agentCard.description,
      documentationUrl: agentCard.documentationUrl || undefined,
      name: agentCard.name,
      preferredTransport: agentCard.preferredTransport,
      provider: agentCard.provider ? _FromProto.agentProvider(agentCard.provider) : undefined,
      protocolVersion: agentCard.protocolVersion,
      security: agentCard.security?.map((s) => _FromProto.security(s)),
      securitySchemes: agentCard.securitySchemes ? Object.fromEntries(Object.entries(agentCard.securitySchemes).map(([key, value]) => [
        key,
        _FromProto.securityScheme(value)
      ])) : {},
      skills: agentCard.skills.map((s) => _FromProto.skills(s)),
      signatures: agentCard.signatures?.map((s) => _FromProto.agentCardSignature(s)),
      supportsAuthenticatedExtendedCard: agentCard.supportsAuthenticatedExtendedCard,
      url: agentCard.url,
      version: agentCard.version
    };
  }
  static agentCapabilities(capabilities) {
    return {
      extensions: capabilities.extensions?.map((e) => _FromProto.agentExtension(e)),
      pushNotifications: capabilities.pushNotifications,
      streaming: capabilities.streaming
    };
  }
  static agentExtension(extension) {
    return {
      uri: extension.uri,
      description: extension.description || undefined,
      required: extension.required,
      params: extension.params
    };
  }
  static agentInterface(intf) {
    return {
      transport: intf.transport,
      url: intf.url
    };
  }
  static agentProvider(provider) {
    return {
      organization: provider.organization,
      url: provider.url
    };
  }
  static security(security) {
    return Object.fromEntries(Object.entries(security.schemes)?.map(([key, value]) => [key, value.list]));
  }
  static securityScheme(securitySchemes) {
    switch (securitySchemes.scheme?.$case) {
      case "apiKeySecurityScheme":
        return {
          type: "apiKey",
          name: securitySchemes.scheme.value.name,
          in: securitySchemes.scheme.value.location,
          description: securitySchemes.scheme.value.description || undefined
        };
      case "httpAuthSecurityScheme":
        return {
          type: "http",
          scheme: securitySchemes.scheme.value.scheme,
          bearerFormat: securitySchemes.scheme.value.bearerFormat || undefined,
          description: securitySchemes.scheme.value.description || undefined
        };
      case "mtlsSecurityScheme":
        return {
          type: "mutualTLS",
          description: securitySchemes.scheme.value.description || undefined
        };
      case "oauth2SecurityScheme":
        if (!securitySchemes.scheme.value.flows) {
          throw A2AError2.internalError("OAuth2 security scheme missing flows");
        }
        return {
          type: "oauth2",
          description: securitySchemes.scheme.value.description || undefined,
          flows: _FromProto.oauthFlows(securitySchemes.scheme.value.flows),
          oauth2MetadataUrl: securitySchemes.scheme.value.oauth2MetadataUrl || undefined
        };
      case "openIdConnectSecurityScheme":
        return {
          type: "openIdConnect",
          description: securitySchemes.scheme.value.description || undefined,
          openIdConnectUrl: securitySchemes.scheme.value.openIdConnectUrl
        };
      default:
        throw A2AError2.internalError(`Unsupported security scheme type`);
    }
  }
  static oauthFlows(flows) {
    switch (flows.flow?.$case) {
      case "implicit":
        return {
          implicit: {
            authorizationUrl: flows.flow.value.authorizationUrl,
            scopes: flows.flow.value.scopes,
            refreshUrl: flows.flow.value.refreshUrl || undefined
          }
        };
      case "password":
        return {
          password: {
            refreshUrl: flows.flow.value.refreshUrl || undefined,
            scopes: flows.flow.value.scopes,
            tokenUrl: flows.flow.value.tokenUrl
          }
        };
      case "authorizationCode":
        return {
          authorizationCode: {
            refreshUrl: flows.flow.value.refreshUrl || undefined,
            authorizationUrl: flows.flow.value.authorizationUrl,
            scopes: flows.flow.value.scopes,
            tokenUrl: flows.flow.value.tokenUrl
          }
        };
      case "clientCredentials":
        return {
          clientCredentials: {
            refreshUrl: flows.flow.value.refreshUrl || undefined,
            scopes: flows.flow.value.scopes,
            tokenUrl: flows.flow.value.tokenUrl
          }
        };
      default:
        throw A2AError2.internalError(`Unsupported OAuth flows`);
    }
  }
  static skills(skill) {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
      examples: skill.examples,
      inputModes: skill.inputModes,
      outputModes: skill.outputModes,
      security: skill.security?.map((s) => _FromProto.security(s))
    };
  }
  static agentCardSignature(signatures) {
    return {
      protected: signatures.protected,
      signature: signatures.signature,
      header: signatures.header
    };
  }
  static taskStatusUpdateEvent(event) {
    if (!event.status) {
      throw A2AError2.invalidParams("Invalid TaskStatusUpdateEvent: missing status");
    }
    return {
      kind: "status-update",
      taskId: event.taskId,
      status: _FromProto.taskStatus(event.status),
      contextId: event.contextId,
      metadata: event.metadata,
      final: event.final
    };
  }
  static taskArtifactUpdateEvent(event) {
    if (!event.artifact) {
      throw A2AError2.invalidParams("Invalid TaskArtifactUpdateEvent: missing artifact");
    }
    return {
      kind: "artifact-update",
      taskId: event.taskId,
      artifact: _FromProto.artifact(event.artifact),
      contextId: event.contextId,
      metadata: event.metadata,
      lastChunk: event.lastChunk
    };
  }
  static messageStreamResult(event) {
    switch (event.payload?.$case) {
      case "msg":
        return _FromProto.message(event.payload.value);
      case "task":
        return _FromProto.task(event.payload.value);
      case "statusUpdate":
        return _FromProto.taskStatusUpdateEvent(event.payload.value);
      case "artifactUpdate":
        return _FromProto.taskArtifactUpdateEvent(event.payload.value);
      default:
        throw A2AError2.internalError("Invalid event type in StreamResponse");
    }
  }
};
var ToProto = class _ToProto {
  static agentCard(agentCard) {
    return {
      protocolVersion: agentCard.protocolVersion,
      name: agentCard.name,
      description: agentCard.description,
      url: agentCard.url,
      preferredTransport: agentCard.preferredTransport ?? "",
      additionalInterfaces: agentCard.additionalInterfaces?.map((i) => _ToProto.agentInterface(i)) ?? [],
      provider: _ToProto.agentProvider(agentCard.provider),
      version: agentCard.version,
      documentationUrl: agentCard.documentationUrl ?? "",
      capabilities: _ToProto.agentCapabilities(agentCard.capabilities),
      securitySchemes: agentCard.securitySchemes ? Object.fromEntries(Object.entries(agentCard.securitySchemes).map(([key, value]) => [
        key,
        _ToProto.securityScheme(value)
      ])) : {},
      security: agentCard.security?.map((s) => _ToProto.security(s)) ?? [],
      defaultInputModes: agentCard.defaultInputModes,
      defaultOutputModes: agentCard.defaultOutputModes,
      skills: agentCard.skills.map((s) => _ToProto.agentSkill(s)),
      supportsAuthenticatedExtendedCard: agentCard.supportsAuthenticatedExtendedCard ?? false,
      signatures: agentCard.signatures?.map((s) => _ToProto.agentCardSignature(s)) ?? []
    };
  }
  static agentCardSignature(signatures) {
    return {
      protected: signatures.protected,
      signature: signatures.signature,
      header: signatures.header
    };
  }
  static agentSkill(skill) {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags ?? [],
      examples: skill.examples ?? [],
      inputModes: skill.inputModes ?? [],
      outputModes: skill.outputModes ?? [],
      security: skill.security ? skill.security.map((s) => _ToProto.security(s)) : []
    };
  }
  static security(security) {
    return {
      schemes: Object.fromEntries(Object.entries(security).map(([key, value]) => {
        return [key, { list: value }];
      }))
    };
  }
  static securityScheme(scheme) {
    switch (scheme.type) {
      case "apiKey":
        return {
          scheme: {
            $case: "apiKeySecurityScheme",
            value: {
              name: scheme.name,
              location: scheme.in,
              description: scheme.description ?? ""
            }
          }
        };
      case "http":
        return {
          scheme: {
            $case: "httpAuthSecurityScheme",
            value: {
              description: scheme.description ?? "",
              scheme: scheme.scheme,
              bearerFormat: scheme.bearerFormat ?? ""
            }
          }
        };
      case "mutualTLS":
        return {
          scheme: {
            $case: "mtlsSecurityScheme",
            value: {
              description: scheme.description ?? ""
            }
          }
        };
      case "oauth2":
        return {
          scheme: {
            $case: "oauth2SecurityScheme",
            value: {
              description: scheme.description ?? "",
              flows: _ToProto.oauthFlows(scheme.flows),
              oauth2MetadataUrl: scheme.oauth2MetadataUrl ?? ""
            }
          }
        };
      case "openIdConnect":
        return {
          scheme: {
            $case: "openIdConnectSecurityScheme",
            value: {
              description: scheme.description ?? "",
              openIdConnectUrl: scheme.openIdConnectUrl
            }
          }
        };
      default:
        throw A2AError2.internalError(`Unsupported security scheme type`);
    }
  }
  static oauthFlows(flows) {
    if (flows.implicit) {
      return {
        flow: {
          $case: "implicit",
          value: {
            authorizationUrl: flows.implicit.authorizationUrl,
            scopes: flows.implicit.scopes,
            refreshUrl: flows.implicit.refreshUrl ?? ""
          }
        }
      };
    } else if (flows.password) {
      return {
        flow: {
          $case: "password",
          value: {
            tokenUrl: flows.password.tokenUrl,
            scopes: flows.password.scopes,
            refreshUrl: flows.password.refreshUrl ?? ""
          }
        }
      };
    } else if (flows.clientCredentials) {
      return {
        flow: {
          $case: "clientCredentials",
          value: {
            tokenUrl: flows.clientCredentials.tokenUrl,
            scopes: flows.clientCredentials.scopes,
            refreshUrl: flows.clientCredentials.refreshUrl ?? ""
          }
        }
      };
    } else if (flows.authorizationCode) {
      return {
        flow: {
          $case: "authorizationCode",
          value: {
            authorizationUrl: flows.authorizationCode.authorizationUrl,
            tokenUrl: flows.authorizationCode.tokenUrl,
            scopes: flows.authorizationCode.scopes,
            refreshUrl: flows.authorizationCode.refreshUrl ?? ""
          }
        }
      };
    } else {
      throw A2AError2.internalError(`Unsupported OAuth flows`);
    }
  }
  static agentInterface(agentInterface) {
    return {
      transport: agentInterface.transport,
      url: agentInterface.url
    };
  }
  static agentProvider(agentProvider) {
    if (!agentProvider) {
      return;
    }
    return {
      url: agentProvider.url,
      organization: agentProvider.organization
    };
  }
  static agentCapabilities(capabilities) {
    if (!capabilities) {
      return { streaming: false, pushNotifications: false, extensions: [] };
    }
    return {
      streaming: capabilities.streaming ?? false,
      pushNotifications: capabilities.pushNotifications ?? false,
      extensions: capabilities.extensions ? capabilities.extensions.map((e) => _ToProto.agentExtension(e)) : []
    };
  }
  static agentExtension(extension) {
    return {
      uri: extension.uri,
      description: extension.description ?? "",
      required: extension.required ?? false,
      params: extension.params
    };
  }
  static listTaskPushNotificationConfig(config) {
    return {
      configs: config.map((c) => _ToProto.taskPushNotificationConfig(c)),
      nextPageToken: ""
    };
  }
  static getTaskPushNotificationConfigParams(config) {
    return {
      name: generatePushNotificationConfigName(config.id, config.pushNotificationConfigId ?? "")
    };
  }
  static listTaskPushNotificationConfigParams(config) {
    return {
      parent: generateTaskName(config.id),
      pageToken: "",
      pageSize: 0
    };
  }
  static deleteTaskPushNotificationConfigParams(config) {
    return {
      name: generatePushNotificationConfigName(config.id, config.pushNotificationConfigId)
    };
  }
  static taskPushNotificationConfig(config) {
    return {
      name: generatePushNotificationConfigName(config.taskId, config.pushNotificationConfig.id ?? ""),
      pushNotificationConfig: _ToProto.pushNotificationConfig(config.pushNotificationConfig)
    };
  }
  static taskPushNotificationConfigCreate(config) {
    return {
      parent: generateTaskName(config.taskId),
      config: _ToProto.taskPushNotificationConfig(config),
      configId: config.pushNotificationConfig.id ?? ""
    };
  }
  static pushNotificationConfig(config) {
    if (!config) {
      return;
    }
    return {
      id: config.id ?? "",
      url: config.url,
      token: config.token ?? "",
      authentication: _ToProto.pushNotificationAuthenticationInfo(config.authentication)
    };
  }
  static pushNotificationAuthenticationInfo(authInfo) {
    if (!authInfo) {
      return;
    }
    return {
      schemes: authInfo.schemes,
      credentials: authInfo.credentials ?? ""
    };
  }
  static messageStreamResult(event) {
    if (event.kind === "message") {
      return {
        payload: {
          $case: "msg",
          value: _ToProto.message(event)
        }
      };
    } else if (event.kind === "task") {
      return {
        payload: {
          $case: "task",
          value: _ToProto.task(event)
        }
      };
    } else if (event.kind === "status-update") {
      return {
        payload: {
          $case: "statusUpdate",
          value: _ToProto.taskStatusUpdateEvent(event)
        }
      };
    } else if (event.kind === "artifact-update") {
      return {
        payload: {
          $case: "artifactUpdate",
          value: _ToProto.taskArtifactUpdateEvent(event)
        }
      };
    } else {
      throw A2AError2.internalError("Invalid event type");
    }
  }
  static taskStatusUpdateEvent(event) {
    return {
      taskId: event.taskId,
      status: _ToProto.taskStatus(event.status),
      contextId: event.contextId,
      metadata: event.metadata,
      final: event.final
    };
  }
  static taskArtifactUpdateEvent(event) {
    return {
      taskId: event.taskId,
      artifact: _ToProto.artifact(event.artifact),
      contextId: event.contextId,
      metadata: event.metadata,
      append: event.append ?? false,
      lastChunk: event.lastChunk ?? false
    };
  }
  static messageSendResult(params) {
    if (!params.kind) {
      return;
    }
    if (params.kind === "message") {
      return {
        payload: {
          $case: "msg",
          value: _ToProto.message(params)
        }
      };
    } else if (params.kind === "task") {
      return {
        payload: {
          $case: "task",
          value: _ToProto.task(params)
        }
      };
    }
  }
  static message(message) {
    if (!message) {
      return;
    }
    return {
      messageId: message.messageId,
      content: message.parts.map((p) => _ToProto.part(p)),
      contextId: message.contextId ?? "",
      taskId: message.taskId ?? "",
      role: _ToProto.role(message.role),
      metadata: message.metadata,
      extensions: message.extensions ?? []
    };
  }
  static role(role) {
    switch (role) {
      case "agent":
        return 2;
      case "user":
        return 1;
      default:
        throw A2AError2.internalError(`Invalid role`);
    }
  }
  static task(task) {
    return {
      id: task.id,
      contextId: task.contextId,
      status: _ToProto.taskStatus(task.status),
      artifacts: task.artifacts?.map((a) => _ToProto.artifact(a)) ?? [],
      history: task.history?.map((m) => _ToProto.message(m)).filter((m) => !!m) ?? [],
      metadata: task.metadata
    };
  }
  static taskStatus(status) {
    return {
      state: _ToProto.taskState(status.state),
      update: _ToProto.message(status.message),
      timestamp: status.timestamp
    };
  }
  static artifact(artifact) {
    return {
      artifactId: artifact.artifactId,
      name: artifact.name ?? "",
      description: artifact.description ?? "",
      parts: artifact.parts.map((p) => _ToProto.part(p)),
      metadata: artifact.metadata,
      extensions: artifact.extensions ? artifact.extensions : []
    };
  }
  static taskState(state) {
    switch (state) {
      case "submitted":
        return 1;
      case "working":
        return 2;
      case "input-required":
        return 6;
      case "rejected":
        return 7;
      case "auth-required":
        return 8;
      case "completed":
        return 3;
      case "failed":
        return 4;
      case "canceled":
        return 5;
      case "unknown":
        return 0;
      default:
        return -1;
    }
  }
  static part(part) {
    if (part.kind === "text") {
      return {
        part: { $case: "text", value: part.text }
      };
    }
    if (part.kind === "file") {
      let filePart;
      if ("uri" in part.file) {
        filePart = {
          file: { $case: "fileWithUri", value: part.file.uri },
          mimeType: part.file.mimeType ?? ""
        };
      } else if ("bytes" in part.file) {
        filePart = {
          file: { $case: "fileWithBytes", value: Buffer.from(part.file.bytes, "base64") },
          mimeType: part.file.mimeType ?? ""
        };
      } else {
        throw A2AError2.internalError("Invalid file part");
      }
      return {
        part: { $case: "file", value: filePart }
      };
    }
    if (part.kind === "data") {
      return {
        part: { $case: "data", value: { data: part.data } }
      };
    }
    throw A2AError2.internalError("Invalid part type");
  }
  static messageSendParams(params) {
    return {
      request: _ToProto.message(params.message),
      configuration: _ToProto.configuration(params.configuration),
      metadata: params.metadata
    };
  }
  static configuration(configuration) {
    if (!configuration) {
      return;
    }
    return {
      blocking: configuration.blocking ?? false,
      acceptedOutputModes: configuration.acceptedOutputModes ?? [],
      pushNotification: _ToProto.pushNotificationConfig(configuration.pushNotificationConfig),
      historyLength: configuration.historyLength ?? 0
    };
  }
  static taskQueryParams(params) {
    return {
      name: generateTaskName(params.id),
      historyLength: params.historyLength ?? 0
    };
  }
  static cancelTaskRequest(params) {
    return {
      name: generateTaskName(params.id)
    };
  }
  static taskIdParams(params) {
    return {
      name: generateTaskName(params.id)
    };
  }
  static getAgentCardRequest() {
    return {};
  }
};
var PROTOCOL_NAME2 = "HTTP+JSON";
var LegacyRestTransport = class _LegacyRestTransport {
  customFetchImpl;
  endpoint;
  requestIdCounter = 1;
  constructor(options) {
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.customFetchImpl = options.fetchImpl;
  }
  get protocolName() {
    return PROTOCOL_NAME2;
  }
  get protocolVersion() {
    return A2A_LEGACY_PROTOCOL_VERSION;
  }
  async getExtendedAgentCard(_params, options) {
    const protoCard = await this._sendRequestJson("GET", "/v1/card", undefined, AgentCard2, options);
    return toCoreAgentCard(FromProto.agentCard(protoCard));
  }
  async sendMessage(params, options) {
    const body = this._buildSendMessageRequestJson(params);
    const result = await this._sendRequestJson("POST", "/v1/message:send", body, SendMessageResponse2, options);
    return _LegacyRestTransport._parseProtoSendMessageResult(result);
  }
  async* sendMessageStream(params, options) {
    const body = this._buildSendMessageRequestJson(params);
    yield* this._sendStreamingRequest("/v1/message:stream", "POST", body, options);
  }
  async createTaskPushNotificationConfig(params, options) {
    const protoConfig = ToProto.taskPushNotificationConfig(toCompatTaskPushNotificationConfig(params));
    const body = TaskPushNotificationConfig2.toJSON(protoConfig);
    const path = `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`;
    const result = await this._sendRequestJson("POST", path, body, TaskPushNotificationConfig2, options);
    return toCoreTaskPushNotificationConfig(FromProto.taskPushNotificationConfig(result));
  }
  async getTaskPushNotificationConfig(params, options) {
    const path = `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/` + encodeURIComponent(params.id);
    const result = await this._sendRequestJson("GET", path, undefined, TaskPushNotificationConfig2, options);
    return toCoreTaskPushNotificationConfig(FromProto.taskPushNotificationConfig(result));
  }
  async listTaskPushNotificationConfig(params, options) {
    const path = `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`;
    const result = await this._sendRequestJson("GET", path, undefined, ListTaskPushNotificationConfigResponse, options);
    const protoConfigs = result?.configs ?? [];
    const legacyConfigs = protoConfigs.map((c) => FromProto.taskPushNotificationConfig(c));
    return toCoreListTaskPushNotificationConfigsResponse({
      id: this._nextResponseId(),
      jsonrpc: "2.0",
      result: legacyConfigs
    });
  }
  async deleteTaskPushNotificationConfig(params, options) {
    const path = `/v1/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/` + encodeURIComponent(params.id);
    await this._sendRequestJson("DELETE", path, undefined, undefined, options);
  }
  async getTask(params, options) {
    const queryParams = new URLSearchParams;
    if (params.historyLength !== undefined) {
      queryParams.set("historyLength", String(params.historyLength));
    }
    const queryString = queryParams.toString();
    const path = `/v1/tasks/${encodeURIComponent(params.id)}${queryString ? `?${queryString}` : ""}`;
    const result = await this._sendRequestJson("GET", path, undefined, Task2, options);
    return toCoreTask(FromProto.task(result));
  }
  async cancelTask(params, options) {
    const path = `/v1/tasks/${encodeURIComponent(params.id)}:cancel`;
    const result = await this._sendRequestJson("POST", path, undefined, Task2, options);
    return toCoreTask(FromProto.task(result));
  }
  async listTasks(_params, _options) {
    throw new UnsupportedOperationError("tasks/list has no equivalent in v0.3 HTTP+JSON");
  }
  async* resubscribeTask(params, options) {
    const path = `/v1/tasks/${encodeURIComponent(params.id)}:subscribe`;
    yield* this._sendStreamingRequest(path, "GET", undefined, options);
  }
  _buildSendMessageRequestJson(core) {
    const envelope = toCompatSendMessageRequest(core, this.requestIdCounter++);
    const protoRequest = ToProto.messageSendParams(envelope.params);
    return SendMessageRequest2.toJSON(protoRequest);
  }
  _nextResponseId() {
    return this.requestIdCounter++;
  }
  _fetch(...args) {
    if (this.customFetchImpl) {
      return this.customFetchImpl(...args);
    }
    if (typeof fetch === "function") {
      return fetch(...args);
    }
    throw new Error("A `fetch` implementation was not provided and is not available in the global scope. Please provide a `fetchImpl` in the LegacyRestTransportOptions.");
  }
  _buildHeaders(options, acceptHeader = LEGACY_JSON_CONTENT_TYPE) {
    return {
      ...options?.serviceParameters,
      "Content-Type": LEGACY_JSON_CONTENT_TYPE,
      Accept: acceptHeader
    };
  }
  async _sendRequestJson(method, path, body, responseType, options) {
    const url = `${this.endpoint}${path}`;
    const requestInit = {
      method,
      headers: this._buildHeaders(options),
      signal: options?.signal
    };
    if (body !== undefined && method !== "GET" && method !== "DELETE") {
      requestInit.body = JSON.stringify(body);
    }
    const response = await this._fetch(url, requestInit);
    if (!response.ok) {
      await _LegacyRestTransport._handleErrorResponse(response, path);
    }
    if (response.status === 204 || responseType === undefined) {
      return;
    }
    const text = await response.text();
    if (!text) {
      return;
    }
    const json = JSON.parse(text);
    return responseType.fromJSON(json);
  }
  async* _sendStreamingRequest(path, method, body, options) {
    const url = `${this.endpoint}${path}`;
    const requestInit = {
      method,
      headers: this._buildHeaders(options, "text/event-stream"),
      signal: options?.signal
    };
    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }
    const response = await this._fetch(url, requestInit);
    if (!response.ok) {
      await _LegacyRestTransport._handleErrorResponse(response, path);
    }
    const contentType = response.headers.get("Content-Type");
    if (!contentType?.startsWith("text/event-stream")) {
      throw new Error(`Invalid response Content-Type for SSE stream. Expected 'text/event-stream', got '${contentType}'.`);
    }
    for await (const event of parseSseStream(response)) {
      if (event.type === "error") {
        throw _LegacyRestTransport._parseSseErrorEvent(event.data);
      }
      yield _LegacyRestTransport._processSseEventData(event.data);
    }
  }
  static _processSseEventData(jsonData) {
    if (!jsonData.trim()) {
      throw new Error("Attempted to process empty SSE event data.");
    }
    let protoEnvelope;
    try {
      protoEnvelope = StreamResponse2.fromJSON(JSON.parse(jsonData));
    } catch (e) {
      throw new Error(`Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${e instanceof Error && e.message || "Unknown error"}`, { cause: e });
    }
    if (!protoEnvelope.payload) {
      throw new InvalidAgentResponseError("Invalid SSE event: v0.3 StreamResponse has no payload.");
    }
    let legacyResult;
    switch (protoEnvelope.payload.$case) {
      case "task":
        legacyResult = FromProto.task(protoEnvelope.payload.value);
        break;
      case "msg": {
        const m = FromProto.message(protoEnvelope.payload.value);
        if (!m) {
          throw new InvalidAgentResponseError("Invalid SSE event: v0.3 message payload is empty.");
        }
        legacyResult = m;
        break;
      }
      case "statusUpdate":
        legacyResult = FromProto.taskStatusUpdateEvent(protoEnvelope.payload.value);
        break;
      case "artifactUpdate":
        legacyResult = FromProto.taskArtifactUpdateEvent(protoEnvelope.payload.value);
        break;
      default:
        throw new InvalidAgentResponseError(`Unexpected v0.3 StreamResponse payload case: ${String(protoEnvelope.payload.$case)}`);
    }
    return toCoreStreamResponse({ id: null, jsonrpc: "2.0", result: legacyResult });
  }
  static _parseSseErrorEvent(jsonData) {
    try {
      const parsed = JSON.parse(jsonData);
      if (_LegacyRestTransport._isLegacyRestErrorBody(parsed)) {
        return _LegacyRestTransport._errorFromLegacyBody(parsed);
      }
      return new Error(`SSE error event: ${jsonData}`);
    } catch {
      return new Error(`SSE error event (unparseable): ${jsonData}`);
    }
  }
  static async _handleErrorResponse(response, path) {
    let errorBodyText = "(empty or non-JSON response)";
    let errorBody;
    try {
      errorBodyText = await response.text();
      if (errorBodyText) {
        const parsed = JSON.parse(errorBodyText);
        if (_LegacyRestTransport._isLegacyRestErrorBody(parsed)) {
          errorBody = parsed;
        }
      }
    } catch {}
    if (errorBody) {
      throw _LegacyRestTransport._errorFromLegacyBody(errorBody);
    }
    throw new Error(`HTTP error for ${path}! Status: ${response.status} ${response.statusText}. Response: ${errorBodyText}`);
  }
  static _errorFromLegacyBody(body) {
    const name = JSON_RPC_CODE_TO_ERROR[body.code];
    if (name)
      return new A2A_ERROR_CLASSES[name]({ message: body.message });
    const dataSuffix = body.data ? ` Data: ${JSON.stringify(body.data)}` : "";
    return new Error(`REST error: ${body.message} (Code: ${body.code})${dataSuffix}`);
  }
  static _isLegacyRestErrorBody(value) {
    return typeof value === "object" && value !== null && typeof value.code === "number" && typeof value.message === "string";
  }
  static _parseProtoSendMessageResult(response) {
    if (!response || !response.payload) {
      throw new InvalidAgentResponseError("Invalid response: v0.3 message:send response payload is missing.");
    }
    if (response.payload.$case === "task") {
      return toCoreTask(FromProto.task(response.payload.value));
    }
    if (response.payload.$case === "msg") {
      const legacyMessage = FromProto.message(response.payload.value);
      if (!legacyMessage) {
        throw new InvalidAgentResponseError("Invalid response: v0.3 message:send returned an empty Message payload.");
      }
      return toCoreMessage(legacyMessage);
    }
    throw new InvalidAgentResponseError(`Unexpected v0.3 SendMessageResponse payload case: ${String(response.payload.$case)}`);
  }
};
var DefaultAgentCardResolver = class {
  constructor(options) {
    this.options = options;
  }
  async resolve(baseUrl, path) {
    const agentCardUrl = new URL(path ?? this.options?.path ?? AGENT_CARD_PATH, baseUrl);
    const response = await this.fetchImpl(agentCardUrl, {
      headers: { [A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch Agent Card from ${agentCardUrl}: ${response.status}`);
    }
    const rawCard = await response.json();
    return this.normalizeAgentCard(rawCard);
  }
  fetchImpl(...args) {
    if (this.options?.fetchImpl) {
      return this.options.fetchImpl(...args);
    }
    return fetch(...args);
  }
  normalizeAgentCard(card) {
    if (this.options?.legacyCompat?.enabled) {
      if (isLegacyAgentCard(card)) {
        return parseLegacyAgentCard(card);
      }
    }
    if (this.isProtoAgentCard(card)) {
      const parsedProto = AgentCard.fromJSON(card);
      return parsedProto;
    }
    return card;
  }
  isProtoAgentCard(card) {
    if (!card || typeof card !== "object")
      return false;
    const c = card;
    if (this.hasProtoSecurity(c.security))
      return true;
    if (this.hasProtoSecuritySchemes(c.securitySchemes))
      return true;
    if (Array.isArray(c.skills)) {
      return c.skills.some((skill) => skill && typeof skill === "object" && this.hasProtoSecurity(skill.security));
    }
    return false;
  }
  hasProtoSecurity(securityArray) {
    if (Array.isArray(securityArray) && securityArray.length > 0) {
      const first = securityArray[0];
      return first && typeof first === "object" && "schemes" in first;
    }
    return false;
  }
  hasProtoSecuritySchemes(securitySchemes) {
    if (securitySchemes && typeof securitySchemes === "object") {
      const schemes = Object.values(securitySchemes);
      if (schemes.length > 0) {
        const first = schemes[0];
        return first && typeof first === "object" && !("type" in first);
      }
    }
    return false;
  }
};
var AgentCardResolver = {
  default: new DefaultAgentCardResolver
};
var ServiceParameters = {
  create(...updates) {
    return ServiceParameters.createFrom(undefined, ...updates);
  },
  createFrom: (serviceParameters, ...updates) => {
    const result = serviceParameters ? { ...serviceParameters } : {};
    for (const update of updates) {
      update(result);
    }
    return result;
  }
};
function withA2AVersion(version) {
  return (parameters) => {
    parameters[A2A_VERSION_HEADER] = version;
  };
}
var Client = class {
  constructor(transport, agentCard, config) {
    this.transport = transport;
    this.agentCard = agentCard;
    this.config = config;
  }
  get protocolVersion() {
    return this.transport.protocolVersion;
  }
  async getAgentCard(options, verifySignature) {
    if (this.agentCard.capabilities?.extendedAgentCard) {
      this.agentCard = await this.executeWithInterceptors({ method: "getAgentCard" }, options, (_, options2) => this.transport.getExtendedAgentCard({ tenant: "" }, options2));
    }
    if (verifySignature) {
      await verifySignature(this.agentCard);
    }
    return this.agentCard;
  }
  sendMessage(params, options) {
    params = this.applyClientConfig({
      params,
      returnImmediately: this.config?.polling ?? false
    });
    return this.executeWithInterceptors({ method: "sendMessage", value: params }, options, this.transport.sendMessage.bind(this.transport));
  }
  async* sendMessageStream(params, options) {
    const method = "sendMessageStream";
    params = this.applyClientConfig({ params, returnImmediately: false });
    const beforeArgs = {
      input: { method, value: params },
      agentCard: this.agentCard,
      options: this.withNormalizedHeaders(options)
    };
    const beforeResult = await this.interceptBefore(beforeArgs);
    if (beforeResult) {
      const earlyReturn = beforeResult.earlyReturn.value;
      const afterArgs = {
        result: { method, value: earlyReturn },
        agentCard: this.agentCard,
        options: beforeArgs.options
      };
      await this.interceptAfter(afterArgs, beforeResult.executed);
      yield afterArgs.result.value;
      return;
    }
    if (!this.agentCard.capabilities?.streaming) {
      const result = await this.transport.sendMessage(beforeArgs.input.value, beforeArgs.options);
      let streamValue;
      if ("messageId" in result) {
        streamValue = { payload: { $case: "message", value: result } };
      } else {
        streamValue = { payload: { $case: "task", value: result } };
      }
      const afterArgs = {
        result: { method, value: streamValue },
        agentCard: this.agentCard,
        options: beforeArgs.options
      };
      await this.interceptAfter(afterArgs);
      yield afterArgs.result.value;
      return;
    }
    for await (const event of this.transport.sendMessageStream(beforeArgs.input.value, beforeArgs.options)) {
      const afterArgs = {
        result: { method, value: event },
        agentCard: this.agentCard,
        options: beforeArgs.options
      };
      await this.interceptAfter(afterArgs);
      yield afterArgs.result.value;
      if (afterArgs.earlyReturn) {
        return;
      }
    }
  }
  createTaskPushNotificationConfig(params, options) {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw new PushNotificationNotSupportedError;
    }
    return this.executeWithInterceptors({ method: "createTaskPushNotificationConfig", value: params }, options, this.transport.createTaskPushNotificationConfig.bind(this.transport));
  }
  getTaskPushNotificationConfig(params, options) {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw new PushNotificationNotSupportedError;
    }
    return this.executeWithInterceptors({ method: "getTaskPushNotificationConfig", value: params }, options, this.transport.getTaskPushNotificationConfig.bind(this.transport));
  }
  listTaskPushNotificationConfig(params, options) {
    if (!this.agentCard.capabilities?.pushNotifications) {
      throw new PushNotificationNotSupportedError;
    }
    return this.executeWithInterceptors({ method: "listTaskPushNotificationConfig", value: params }, options, this.transport.listTaskPushNotificationConfig.bind(this.transport));
  }
  deleteTaskPushNotificationConfig(params, options) {
    return this.executeWithInterceptors({ method: "deleteTaskPushNotificationConfig", value: params }, options, this.transport.deleteTaskPushNotificationConfig.bind(this.transport));
  }
  getTask(params, options) {
    return this.executeWithInterceptors({ method: "getTask", value: params }, options, this.transport.getTask.bind(this.transport));
  }
  cancelTask(params, options) {
    return this.executeWithInterceptors({ method: "cancelTask", value: params }, options, this.transport.cancelTask.bind(this.transport));
  }
  listTasks(params, options) {
    return this.executeWithInterceptors({ method: "listTasks", value: params }, options, this.transport.listTasks.bind(this.transport));
  }
  async* resubscribeTask(params, options) {
    const method = "resubscribeTask";
    const beforeArgs = {
      input: { method, value: params },
      agentCard: this.agentCard,
      options: this.withNormalizedHeaders(options)
    };
    const beforeResult = await this.interceptBefore(beforeArgs);
    if (beforeResult) {
      const earlyReturn = beforeResult.earlyReturn.value;
      const afterArgs = {
        result: { method, value: earlyReturn },
        agentCard: this.agentCard,
        options: beforeArgs.options
      };
      await this.interceptAfter(afterArgs, beforeResult.executed);
      yield afterArgs.result.value;
      return;
    }
    for await (const event of this.transport.resubscribeTask(beforeArgs.input.value, beforeArgs.options)) {
      const afterArgs = {
        result: { method, value: event },
        agentCard: this.agentCard,
        options: beforeArgs.options
      };
      await this.interceptAfter(afterArgs);
      yield afterArgs.result.value;
      if (afterArgs.earlyReturn) {
        return;
      }
    }
  }
  applyClientConfig({
    params,
    returnImmediately
  }) {
    const result = {
      ...params,
      configuration: params.configuration ?? {}
    };
    result.configuration.acceptedOutputModes = result.configuration.acceptedOutputModes ?? this.config?.acceptedOutputModes ?? [];
    if (!result.configuration.taskPushNotificationConfig && this.config?.pushNotificationConfig) {
      if (params.message?.taskId !== undefined) {
        result.configuration.taskPushNotificationConfig = this.config.pushNotificationConfig;
      }
    }
    result.configuration.returnImmediately ??= returnImmediately;
    return result;
  }
  withNormalizedHeaders(options) {
    const serviceParameters = ServiceParameters.createFrom(options?.serviceParameters, withA2AVersion(this.protocolVersion));
    const legacy = isLegacyVersion(this.protocolVersion);
    const canonical = legacy ? LEGACY_HTTP_EXTENSION_HEADER : HTTP_EXTENSION_HEADER;
    const alias = legacy ? HTTP_EXTENSION_HEADER : LEGACY_HTTP_EXTENSION_HEADER;
    const canonicalLower = canonical.toLowerCase();
    const aliasLower = alias.toLowerCase();
    let canonicalValue;
    let exactCanonicalSeen = false;
    let aliasValue;
    let exactAliasSeen = false;
    for (const key of Object.keys(serviceParameters)) {
      const keyLower = key.toLowerCase();
      if (keyLower === canonicalLower) {
        if (key === canonical) {
          canonicalValue = serviceParameters[key];
          exactCanonicalSeen = true;
        } else if (!exactCanonicalSeen) {
          canonicalValue = serviceParameters[key];
        }
        delete serviceParameters[key];
      } else if (keyLower === aliasLower) {
        if (key === alias) {
          aliasValue = serviceParameters[key];
          exactAliasSeen = true;
        } else if (!exactAliasSeen) {
          aliasValue = serviceParameters[key];
        }
        delete serviceParameters[key];
      }
    }
    if (canonicalValue !== undefined) {
      serviceParameters[canonical] = canonicalValue;
    } else if (aliasValue !== undefined) {
      serviceParameters[canonical] = aliasValue;
    }
    return {
      ...options,
      serviceParameters
    };
  }
  async executeWithInterceptors(input, options, transportCall) {
    const beforeArgs = {
      input,
      agentCard: this.agentCard,
      options: this.withNormalizedHeaders(options)
    };
    const beforeResult = await this.interceptBefore(beforeArgs);
    if (beforeResult) {
      const afterArgs2 = {
        result: {
          method: input.method,
          value: beforeResult.earlyReturn.value
        },
        agentCard: this.agentCard,
        options: beforeArgs.options
      };
      await this.interceptAfter(afterArgs2, beforeResult.executed);
      return afterArgs2.result.value;
    }
    const result = await transportCall(beforeArgs.input.value, beforeArgs.options);
    const afterArgs = {
      result: { method: input.method, value: result },
      agentCard: this.agentCard,
      options: beforeArgs.options
    };
    await this.interceptAfter(afterArgs);
    return afterArgs.result.value;
  }
  async interceptBefore(args) {
    if (!this.config?.interceptors || this.config.interceptors.length === 0) {
      return;
    }
    const executed = [];
    for (const interceptor of this.config.interceptors) {
      await interceptor.before(args);
      executed.push(interceptor);
      if (args.earlyReturn) {
        return {
          earlyReturn: args.earlyReturn,
          executed
        };
      }
    }
  }
  async interceptAfter(args, interceptors) {
    const reversedInterceptors = [...interceptors ?? this.config?.interceptors ?? []].reverse();
    for (const interceptor of reversedInterceptors) {
      await interceptor.after(args);
      if (args.earlyReturn) {
        return;
      }
    }
  }
};
var TenantTransportDecorator = class {
  constructor(base, defaultTenant) {
    this.base = base;
    this.defaultTenant = defaultTenant;
  }
  get protocolName() {
    return this.base.protocolName;
  }
  get protocolVersion() {
    return this.base.protocolVersion;
  }
  _resolveTenant(tenant) {
    return tenant || this.defaultTenant;
  }
  async getExtendedAgentCard(params, options) {
    return this.base.getExtendedAgentCard({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }
  async sendMessage(params, options) {
    return this.base.sendMessage({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }
  async* sendMessageStream(params, options) {
    yield* this.base.sendMessageStream({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }
  async getTask(params, options) {
    return this.base.getTask({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }
  async cancelTask(params, options) {
    return this.base.cancelTask({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }
  async listTasks(params, options) {
    return this.base.listTasks({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }
  async createTaskPushNotificationConfig(params, options) {
    return this.base.createTaskPushNotificationConfig({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }
  async getTaskPushNotificationConfig(params, options) {
    return this.base.getTaskPushNotificationConfig({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }
  async listTaskPushNotificationConfig(params, options) {
    return this.base.listTaskPushNotificationConfig({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }
  async deleteTaskPushNotificationConfig(params, options) {
    return this.base.deleteTaskPushNotificationConfig({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }
  async* resubscribeTask(params, options) {
    yield* this.base.resubscribeTask({ ...params, tenant: this._resolveTenant(params.tenant) }, options);
  }
};
function pickMatchingInterface(agentCard, protocolBinding, url) {
  const target = protocolBinding.toUpperCase();
  const candidates = (agentCard.supportedInterfaces ?? []).filter((i) => i.protocolBinding?.toUpperCase() === target);
  if (candidates.length === 0)
    return;
  const byUrl = candidates.filter((i) => i.url === url);
  const pool = byUrl.length > 0 ? byUrl : candidates;
  return pool.find((i) => i.protocolVersion === "1.0") ?? pool[0];
}
var PROTOCOL_NAME3 = "JSONRPC";
var JsonRpcTransport = class {
  customFetchImpl;
  endpoint;
  requestIdCounter = 1;
  constructor(options) {
    this.endpoint = options.endpoint;
    this.customFetchImpl = options.fetchImpl;
  }
  get protocolName() {
    return PROTOCOL_NAME3;
  }
  get protocolVersion() {
    return A2A_PROTOCOL_VERSION;
  }
  async getExtendedAgentCard(params, options) {
    const rpcResponse = await this._sendRpcRequest("GetExtendedAgentCard", params, options, GetExtendedAgentCardRequest);
    return AgentCard.fromJSON(rpcResponse.result);
  }
  async sendMessage(params, options) {
    const rpcResponse = await this._sendRpcRequest("SendMessage", params, options, SendMessageRequest);
    const response = SendMessageResponse.fromJSON(rpcResponse.result);
    if (!response.payload) {
      throw new Error("Invalid response: missing payload");
    }
    return response.payload.value;
  }
  async* sendMessageStream(params, options) {
    yield* this._sendStreamingRequest("SendStreamingMessage", params, options, SendMessageRequest);
  }
  async createTaskPushNotificationConfig(params, options) {
    const rpcResponse = await this._sendRpcRequest("CreateTaskPushNotificationConfig", params, options, TaskPushNotificationConfig);
    return TaskPushNotificationConfig.fromJSON(rpcResponse.result);
  }
  async getTaskPushNotificationConfig(params, options) {
    const rpcResponse = await this._sendRpcRequest("GetTaskPushNotificationConfig", params, options, GetTaskPushNotificationConfigRequest);
    return TaskPushNotificationConfig.fromJSON(rpcResponse.result);
  }
  async listTaskPushNotificationConfig(params, options) {
    const rpcResponse = await this._sendRpcRequest("ListTaskPushNotificationConfigs", params, options, ListTaskPushNotificationConfigsRequest);
    return ListTaskPushNotificationConfigsResponse.fromJSON(rpcResponse.result);
  }
  async deleteTaskPushNotificationConfig(params, options) {
    await this._sendRpcRequest("DeleteTaskPushNotificationConfig", params, options, DeleteTaskPushNotificationConfigRequest);
  }
  async getTask(params, options) {
    const rpcResponse = await this._sendRpcRequest("GetTask", params, options, GetTaskRequest);
    return Task.fromJSON(rpcResponse.result);
  }
  async cancelTask(params, options) {
    const rpcResponse = await this._sendRpcRequest("CancelTask", params, options, CancelTaskRequest);
    return Task.fromJSON(rpcResponse.result);
  }
  async listTasks(params, options) {
    const rpcResponse = await this._sendRpcRequest("ListTasks", params, options, ListTasksRequest);
    return ListTasksResponse.fromJSON(rpcResponse.result);
  }
  async* resubscribeTask(params, options) {
    yield* this._sendStreamingRequest("SubscribeToTask", params, options, SubscribeToTaskRequest);
  }
  async callExtensionMethod(method, params, options) {
    return await this._sendRpcRequest(method, params, options, undefined);
  }
  _fetch(...args) {
    if (this.customFetchImpl) {
      return this.customFetchImpl(...args);
    }
    if (typeof fetch === "function") {
      return fetch(...args);
    }
    throw new Error("A `fetch` implementation was not provided and is not available in the global scope. Please provide a `fetchImpl` in the A2ATransportOptions. ");
  }
  async _sendRpcRequest(method, params, options, requestType) {
    const requestId = this.requestIdCounter++;
    const rpcRequest = {
      jsonrpc: "2.0",
      method,
      params: requestType?.toJSON(params) ?? params,
      id: requestId
    };
    const httpResponse = await this._fetchRpc(rpcRequest, JSON_CONTENT_TYPE, options);
    if (!httpResponse.ok) {
      let errorBodyText = "(empty or non-JSON response)";
      let errorJson;
      try {
        errorBodyText = await httpResponse.text();
        errorJson = JSON.parse(errorBodyText);
      } catch (e) {
        throw new Error(`HTTP error for ${method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`, { cause: e });
      }
      if (errorJson.jsonrpc && errorJson.error) {
        throw fromJsonRpcErrorResponse(errorJson);
      } else {
        throw new Error(`HTTP error for ${method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`);
      }
    }
    const json = await httpResponse.json();
    if ("error" in json) {
      throw fromJsonRpcErrorResponse(json);
    }
    const rpcResponse = json;
    if (rpcResponse.id !== requestId) {
      throw new Error(`JSON-RPC response ID mismatch for method ${method}. Expected ${requestId}, got ${rpcResponse.id}.`);
    }
    return rpcResponse;
  }
  async _fetchRpc(rpcRequest, acceptHeader = JSON_CONTENT_TYPE, options) {
    const requestInit = {
      method: "POST",
      headers: {
        ...options?.serviceParameters,
        "Content-Type": JSON_CONTENT_TYPE,
        Accept: acceptHeader
      },
      body: JSON.stringify(rpcRequest),
      signal: options?.signal
    };
    return this._fetch(this.endpoint, requestInit);
  }
  async* _sendStreamingRequest(method, params, options, requestType) {
    const clientRequestId = this.requestIdCounter++;
    const rpcRequest = {
      jsonrpc: "2.0",
      method,
      params: requestType?.toJSON(params) ?? params,
      id: clientRequestId
    };
    const response = await this._fetchRpc(rpcRequest, "text/event-stream", options);
    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
        const errorJson = JSON.parse(errorBody);
        if (errorJson.error) {
          throw fromJsonRpcErrorResponse(errorJson);
        }
      } catch (e) {
        if (e instanceof Error && e.name !== "SyntaxError") {
          throw e;
        }
      }
      throw new Error(`HTTP error establishing stream for ${method}: ${response.status} ${response.statusText}. Response: ${errorBody || "(empty)"}`);
    }
    if (!response.headers.get("Content-Type")?.startsWith("text/event-stream")) {
      try {
        const body = await response.text();
        const errorJson = JSON.parse(body);
        if (errorJson.error) {
          throw fromJsonRpcErrorResponse(errorJson);
        }
      } catch (e) {
        if (e instanceof Error && e.name !== "SyntaxError") {
          throw e;
        }
      }
      throw new Error(`Invalid response Content-Type for SSE stream for ${method}. Expected 'text/event-stream'.`);
    }
    for await (const event of parseSseStream(response)) {
      yield this._processSseEventData(event.data, clientRequestId);
    }
  }
  _processSseEventData(jsonData, originalRequestId) {
    if (!jsonData.trim()) {
      throw new Error("Attempted to process empty SSE event data.");
    }
    let a2aStreamResponse;
    try {
      a2aStreamResponse = JSON.parse(jsonData);
    } catch (e) {
      throw new Error(`Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${e instanceof Error && e.message || "Unknown error"}`, { cause: e });
    }
    if (a2aStreamResponse.id !== originalRequestId) {
      throw new Error(`JSON-RPC response ID mismatch in SSE event. Expected ${originalRequestId}, got ${a2aStreamResponse.id}.`);
    }
    if ("error" in a2aStreamResponse) {
      const err = a2aStreamResponse.error;
      throw new Error(`SSE event contained an error: ${err.message} (Code: ${err.code}) Data: ${JSON.stringify(err.data || {})}`, { cause: fromJsonRpcErrorResponse(a2aStreamResponse) });
    }
    if (!("result" in a2aStreamResponse) || typeof a2aStreamResponse.result === "undefined") {
      throw new Error(`SSE event JSON-RPC response is missing 'result' field. Data: ${jsonData}`);
    }
    return StreamResponse.fromJSON(a2aStreamResponse.result);
  }
};
var JsonRpcTransportFactory = class {
  constructor(options) {
    this.options = options;
  }
  get protocolName() {
    return PROTOCOL_NAME3;
  }
  async create(url, agentCard) {
    if (this.options?.legacyCompat?.enabled) {
      const iface = pickMatchingInterface(agentCard, PROTOCOL_NAME3, url);
      if (iface && isLegacyVersion(iface.protocolVersion)) {
        return new LegacyJsonRpcTransport({
          endpoint: url,
          fetchImpl: this.options?.fetchImpl
        });
      }
    }
    return new JsonRpcTransport({
      endpoint: url,
      fetchImpl: this.options?.fetchImpl
    });
  }
};
var FromProto2 = class {
  static sendMessageResult(response) {
    if (response.payload?.$case === "task" || response.payload?.$case === "message") {
      return response.payload.value;
    }
    throw new A2AError("Invalid SendMessageResponse: missing result");
  }
};
var PROTOCOL_NAME4 = "HTTP+JSON";
var RestTransport = class _RestTransport {
  customFetchImpl;
  endpoint;
  constructor(options) {
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.customFetchImpl = options.fetchImpl;
  }
  _buildPath(path, tenant) {
    return tenant ? "/" + encodeURIComponent(tenant) + path : path;
  }
  get protocolName() {
    return PROTOCOL_NAME4;
  }
  get protocolVersion() {
    return A2A_PROTOCOL_VERSION;
  }
  async getExtendedAgentCard(params, options) {
    const path = this._buildPath("/extendedAgentCard", params.tenant);
    const response = await this._sendRequest("GET", path, undefined, options, undefined, AgentCard);
    return response;
  }
  async sendMessage(params, options) {
    const requestBody = params;
    const path = this._buildPath("/message:send", params.tenant);
    const response = await this._sendRequest("POST", path, requestBody, options, SendMessageRequest, SendMessageResponse);
    return FromProto2.sendMessageResult(response);
  }
  async* sendMessageStream(params, options) {
    const requestBody = SendMessageRequest.toJSON(params);
    const path = this._buildPath("/message:stream", params.tenant);
    yield* this._sendStreamingRequest(path, requestBody, options);
  }
  async createTaskPushNotificationConfig(params, options) {
    const path = this._buildPath(`/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`, params.tenant);
    const response = await this._sendRequest("POST", path, params, options, TaskPushNotificationConfig, TaskPushNotificationConfig);
    return response;
  }
  async getTaskPushNotificationConfig(params, options) {
    const path = this._buildPath(`/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/${encodeURIComponent(params.id)}`, params.tenant);
    const response = await this._sendRequest("GET", path, undefined, options, undefined, TaskPushNotificationConfig);
    return response;
  }
  async listTaskPushNotificationConfig(params, options) {
    const path = this._buildPath(`/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs`, params.tenant);
    const response = await this._sendRequest("GET", path, undefined, options, undefined, ListTaskPushNotificationConfigsResponse);
    return response;
  }
  async deleteTaskPushNotificationConfig(params, options) {
    const path = this._buildPath(`/tasks/${encodeURIComponent(params.taskId)}/pushNotificationConfigs/${encodeURIComponent(params.id)}`, params.tenant);
    await this._sendRequest("DELETE", path, undefined, options, undefined, undefined);
  }
  async getTask(params, options) {
    const queryParams = new URLSearchParams;
    if (params.historyLength !== undefined) {
      queryParams.set("historyLength", params.historyLength.toString());
    }
    const queryString = queryParams.toString();
    const path = this._buildPath(`/tasks/${encodeURIComponent(params.id)}${queryString ? `?${queryString}` : ""}`, params.tenant);
    const response = await this._sendRequest("GET", path, undefined, options, undefined, Task);
    return response;
  }
  async cancelTask(params, options) {
    const path = this._buildPath(`/tasks/${encodeURIComponent(params.id)}:cancel`, params.tenant);
    const response = await this._sendRequest("POST", path, undefined, options, undefined, Task);
    return response;
  }
  async listTasks(params, options) {
    const queryParams = new URLSearchParams;
    if (params.contextId)
      queryParams.set("contextId", params.contextId);
    if (params.status !== undefined && params.status !== 0) {
      queryParams.set("status", taskStateToJSON(params.status));
    }
    if (params.pageSize !== undefined)
      queryParams.set("pageSize", String(params.pageSize));
    if (params.pageToken)
      queryParams.set("pageToken", params.pageToken);
    if (params.historyLength !== undefined)
      queryParams.set("historyLength", String(params.historyLength));
    if (params.statusTimestampAfter)
      queryParams.set("statusTimestampAfter", params.statusTimestampAfter);
    if (params.includeArtifacts !== undefined)
      queryParams.set("includeArtifacts", String(params.includeArtifacts));
    const queryString = queryParams.toString();
    const path = this._buildPath(`/tasks${queryString ? `?${queryString}` : ""}`, params.tenant);
    const response = await this._sendRequest("GET", path, undefined, options, undefined, ListTasksResponse);
    return response;
  }
  async* resubscribeTask(params, options) {
    const path = this._buildPath(`/tasks/${encodeURIComponent(params.id)}:subscribe`, params.tenant);
    yield* this._sendStreamingRequest(path, undefined, options);
  }
  _fetch(...args) {
    if (this.customFetchImpl) {
      return this.customFetchImpl(...args);
    }
    if (typeof fetch === "function") {
      return fetch(...args);
    }
    throw new Error("A `fetch` implementation was not provided and is not available in the global scope. Please provide a `fetchImpl` in the RestTransportOptions.");
  }
  _buildHeaders(options, acceptHeader = `${A2A_CONTENT_TYPE}, ${JSON_CONTENT_TYPE}`) {
    return {
      ...options?.serviceParameters,
      "Content-Type": JSON_CONTENT_TYPE,
      Accept: acceptHeader
    };
  }
  async _sendRequest(method, path, body, options, requestType, responseType) {
    const url = `${this.endpoint}${path}`;
    const requestInit = {
      method,
      headers: this._buildHeaders(options),
      signal: options?.signal
    };
    if (body !== undefined && method !== "GET") {
      if (!requestType) {
        throw new Error(`Bug: Request body provided for ${method} ${path} but no toJson serializer provided.`);
      }
      requestInit.body = JSON.stringify(requestType.toJSON(body));
    }
    const response = await this._fetch(url, requestInit);
    if (!response.ok) {
      await this._handleErrorResponse(response, path);
    }
    if (response.status === 204 || !responseType) {
      return;
    }
    const result = await response.json();
    return responseType.fromJSON(result);
  }
  async _handleErrorResponse(response, path) {
    let errorBodyText = "(empty or non-JSON response)";
    let errorStatus;
    try {
      errorBodyText = await response.text();
      if (errorBodyText) {
        const parsed = JSON.parse(errorBodyText);
        if (parsed?.error && typeof parsed.error === "object") {
          errorStatus = parsed.error;
        }
      }
    } catch {}
    const transportCtx = {
      statusCode: response.status,
      headers: _RestTransport._collectHeaders(response)
    };
    if (errorStatus) {
      throw fromRestErrorBody(errorStatus, transportCtx);
    }
    throw fromRestErrorBody({ message: `HTTP error for ${path}: ${response.status} ${response.statusText}` }, transportCtx);
  }
  static _collectHeaders(response) {
    const out = {};
    response.headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  async* _sendStreamingRequest(path, body, options) {
    const url = `${this.endpoint}${path}`;
    const requestInit = {
      method: "POST",
      headers: this._buildHeaders(options, "text/event-stream"),
      signal: options?.signal
    };
    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }
    const response = await this._fetch(url, requestInit);
    if (!response.ok) {
      await this._handleErrorResponse(response, path);
    }
    const contentType = response.headers.get("Content-Type");
    if (!contentType?.startsWith("text/event-stream")) {
      throw new Error(`Invalid response Content-Type for SSE stream. Expected 'text/event-stream', got '${contentType}'.`);
    }
    const sseTransportCtx = {
      statusCode: response.status,
      headers: _RestTransport._collectHeaders(response)
    };
    for await (const event of parseSseStream(response)) {
      if (event.type === "error") {
        const errorData = JSON.parse(event.data);
        if (errorData.error && typeof errorData.error === "object") {
          throw fromRestErrorBody(errorData.error, sseTransportCtx);
        }
        throw new Error(`SSE error event: ${JSON.stringify(errorData)}`);
      }
      yield this._processSseEventData(event.data);
    }
  }
  _processSseEventData(jsonData) {
    if (!jsonData.trim()) {
      throw new Error("Attempted to process empty SSE event data.");
    }
    try {
      const response = JSON.parse(jsonData);
      return StreamResponse.fromJSON(response);
    } catch (e) {
      console.error("Failed to parse SSE event data:", jsonData, e);
      throw new Error(`Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${e instanceof Error && e.message || "Unknown error"}`);
    }
  }
};
var RestTransportFactory = class {
  constructor(options) {
    this.options = options;
  }
  get protocolName() {
    return PROTOCOL_NAME4;
  }
  async create(url, agentCard) {
    if (this.options?.legacyCompat?.enabled) {
      const iface = pickMatchingInterface(agentCard, PROTOCOL_NAME4, url);
      if (iface && isLegacyVersion(iface.protocolVersion)) {
        return new LegacyRestTransport({
          endpoint: url,
          fetchImpl: this.options?.fetchImpl
        });
      }
    }
    return new RestTransport({
      endpoint: url,
      fetchImpl: this.options?.fetchImpl
    });
  }
};
var ClientFactoryOptions = {
  default: {
    transports: [new JsonRpcTransportFactory, new RestTransportFactory]
  },
  createFrom(original, overrides) {
    return {
      ...original,
      ...overrides,
      transports: mergeTransports(original.transports, overrides.transports),
      clientConfig: {
        ...original.clientConfig ?? {},
        ...overrides.clientConfig ?? {},
        interceptors: mergeArrays(original.clientConfig?.interceptors, overrides.clientConfig?.interceptors),
        acceptedOutputModes: overrides.clientConfig?.acceptedOutputModes ?? original.clientConfig?.acceptedOutputModes
      },
      preferredTransports: overrides.preferredTransports ?? original.preferredTransports
    };
  }
};
var ClientFactory = class {
  constructor(options = ClientFactoryOptions.default) {
    this.options = options;
    if (!options.transports || options.transports.length === 0) {
      throw new Error("No transports provided");
    }
    this.transportsByName = transportsByName(options.transports);
    for (const transport of options.preferredTransports ?? []) {
      if (!this.transportsByName.has(transport)) {
        throw new Error(`Unknown preferred transport: ${transport}, available transports: ${[...this.transportsByName.keys()].join()}`);
      }
    }
    this.agentCardResolver = options.cardResolver ?? AgentCardResolver.default;
  }
  transportsByName;
  agentCardResolver;
  async createFromAgentCard(agentCard) {
    const normalizedAgentCard = this.agentCardResolver.normalizeAgentCard?.(agentCard) ?? agentCard;
    return this.createFromNormalizedAgentCard(normalizedAgentCard);
  }
  async createFromNormalizedAgentCard(agentCard) {
    const interfaces = agentCard.supportedInterfaces ?? [];
    const bestInterfacePerProtocol = new CaseInsensitiveMap;
    for (const agentInterface of interfaces) {
      const existing = bestInterfacePerProtocol.get(agentInterface.protocolBinding);
      if (!existing || agentInterface.protocolVersion === "1.0") {
        bestInterfacePerProtocol.set(agentInterface.protocolBinding, agentInterface);
      }
    }
    const transportsByPreference = [
      ...this.options.preferredTransports ?? [],
      ...interfaces.map((i) => i.protocolBinding)
    ];
    for (const transportName of transportsByPreference) {
      const selectedInterface = bestInterfacePerProtocol.get(transportName);
      const factory = this.transportsByName.get(transportName);
      if (factory && selectedInterface) {
        let transport = await factory.create(selectedInterface.url, agentCard);
        if (selectedInterface.tenant) {
          transport = new TenantTransportDecorator(transport, selectedInterface.tenant);
        }
        return new Client(transport, agentCard, this.options.clientConfig);
      }
    }
    throw new Error("No compatible transport found, available transports: " + [...this.transportsByName.keys()].join());
  }
  async createFromUrl(baseUrl, path) {
    const agentCard = await this.agentCardResolver.resolve(baseUrl, path);
    return this.createFromNormalizedAgentCard(agentCard);
  }
};
function mergeTransports(original, overrides) {
  if (!overrides) {
    return original;
  }
  const result = transportsByName(original);
  const overridesByName = transportsByName(overrides);
  for (const [name, factory] of overridesByName) {
    result.set(name, factory);
  }
  return Array.from(result.values());
}
function transportsByName(transports) {
  const result = new CaseInsensitiveMap;
  if (!transports) {
    return result;
  }
  for (const t of transports) {
    if (result.has(t.protocolName)) {
      throw new Error(`Duplicate protocol name: ${t.protocolName}`);
    }
    result.set(t.protocolName, t);
  }
  return result;
}
function mergeArrays(a1, a2) {
  if (!a1 && !a2) {
    return;
  }
  return [...a1 ?? [], ...a2 ?? []];
}
var CaseInsensitiveMap = class extends Map {
  normalizeKey(key) {
    return key.toUpperCase();
  }
  set(key, value) {
    return super.set(this.normalizeKey(key), value);
  }
  get(key) {
    return super.get(this.normalizeKey(key));
  }
  has(key) {
    return super.has(this.normalizeKey(key));
  }
  delete(key) {
    return super.delete(this.normalizeKey(key));
  }
};

// src/operation.ts
function bounded(work, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let attached = true;
    const detach = () => {
      if (!attached)
        return;
      attached = false;
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      detach();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return work();
    }).then((value) => {
      detach();
      resolve(value);
    }, (error) => {
      detach();
      reject(error);
    });
  });
}

class Operation {
  caller;
  signal;
  controller = new AbortController;
  timer;
  deadline;
  workDeadline;
  constructor(timeoutMs, caller, reserveMs = 0, deadline) {
    this.caller = caller;
    const now = performance.now();
    this.deadline = Math.min(now + timeoutMs, deadline ?? Infinity);
    const remaining = Math.max(0, this.deadline - now);
    this.workDeadline = this.deadline - Math.min(reserveMs, remaining / 5);
    this.signal = caller ? AbortSignal.any([caller, this.controller.signal]) : this.controller.signal;
    if (!Number.isFinite(this.deadline) || this.workDeadline <= now) {
      this.expire();
    } else {
      this.timer = setTimeout(() => this.expire(), this.workDeadline - now);
    }
  }
  async run(work) {
    const checkDeadline = () => {
      if (performance.now() >= this.workDeadline)
        this.expire();
      this.signal.throwIfAborted();
    };
    const result = await bounded(() => {
      checkDeadline();
      return work();
    }, this.signal);
    checkDeadline();
    return result;
  }
  async cleanup(work, limitMs) {
    const now = performance.now();
    const cleanupDeadline = Math.min(this.deadline, now + limitMs);
    if (!(cleanupDeadline > now))
      return;
    const controller = new AbortController;
    const expire = () => controller.abort(new Error("A2A cleanup timed out"));
    const timer = setTimeout(expire, cleanupDeadline - now);
    try {
      const value = await bounded(() => {
        if (performance.now() >= cleanupDeadline)
          expire();
        controller.signal.throwIfAborted();
        return work(controller.signal);
      }, controller.signal);
      if (performance.now() >= cleanupDeadline)
        return;
      return value;
    } catch {
      return;
    } finally {
      clearTimeout(timer);
      expire();
    }
  }
  expire() {
    this.controller.abort(new Error("A2A operation timed out"));
  }
  close() {
    clearTimeout(this.timer);
    this.controller.abort(new Error("A2A operation closed"));
  }
}

// src/client-policy.ts
import { createHash } from "node:crypto";
function ownerKey(owner) {
  if (typeof owner === "string") {
    if (!owner)
      throw new Error("A2A owner is required");
    return JSON.stringify([owner]);
  }
  if (!owner.issuer || !owner.subject || !owner.audience)
    throw new Error("A2A owner is incomplete");
  return JSON.stringify([
    owner.issuer,
    owner.subject,
    owner.audience,
    owner.tenant ?? null
  ]);
}
function destination(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error("Invalid A2A destination");
  }
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || u.hash)
    throw new Error("Invalid A2A destination");
  return u;
}
function origins(values) {
  return new Set(values.map((value) => {
    const u = destination(value);
    if (u.pathname !== "/" || u.search)
      throw new Error("A2A scope must be an origin");
    return u.origin;
  }));
}
function compilePolicy(policy) {
  const allowed = origins(policy.destinationOrigins);
  const credential = policy.credential;
  const scope = origins(credential?.origins ?? []);
  const owner = credential ? ownerKey(credential.owner) : "anonymous";
  const audience = credential?.audience;
  const provide = credential?.provide;
  if (!policy.peerIdentity || credential && (!audience || !credential.headerNames.length))
    throw new Error("Incomplete A2A policy");
  for (const origin of scope)
    if (!allowed.has(origin))
      throw new Error("Credential origin must be an approved destination");
  let trusted;
  try {
    trusted = new Headers(policy.headers);
  } catch {
    throw new Error("Invalid A2A policy headers");
  }
  for (const name of ["authorization", "proxy-authorization", "cookie"])
    if (trusted.has(name))
      throw new Error("Use identity-scoped A2A credentials for authentication headers");
  const names = new Set((credential?.headerNames ?? []).map((name) => name.toLowerCase()));
  for (const name of names) {
    new Headers({ [name]: "" });
    if (trusted.has(name))
      throw new Error("Conflicting A2A policy headers");
  }
  const protectedNames = new Set([
    "authorization",
    "proxy-authorization",
    "cookie",
    "host",
    ...names,
    ...trusted.keys()
  ]);
  const check = (value) => {
    if (!allowed.has(destination(value).origin))
      throw new Error("Unapproved A2A destination");
  };
  const identity = createHash("sha256").update(JSON.stringify([policy.peerIdentity, owner, audience ?? null])).digest("hex");
  return {
    identity,
    check,
    signature: JSON.stringify([
      [...allowed].sort(),
      [...scope].sort(),
      identity,
      [...names].sort(),
      [...trusted.entries()]
    ]),
    provide,
    fetch(base, timeoutMs) {
      return Object.assign(async (request, init) => {
        const operation = new Operation(timeoutMs, init?.signal ?? (request instanceof Request ? request.signal : undefined));
        try {
          const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
          check(url);
          const headers = new Headers(init?.headers ?? (request instanceof Request ? request.headers : undefined));
          for (const name of protectedNames)
            if (headers.has(name) || request instanceof Request && request.headers.has(name))
              throw new Error("Protected A2A request header");
          trusted.forEach((value, name) => headers.set(name, value));
          if (provide && scope.has(new URL(url).origin)) {
            const result = await operation.run(() => provide({
              signal: operation.signal,
              origin: new URL(url).origin,
              audience
            }));
            if (ownerKey(result.owner) !== owner || result.audience !== audience)
              throw new Error("A2A credential identity changed");
            const supplied = new Headers(result.headers);
            for (const name of supplied.keys())
              if (!names.has(name))
                throw new Error("Undeclared A2A credential header");
            for (const name of names)
              if (!supplied.has(name))
                throw new Error("Missing A2A credential header");
            supplied.forEach((value, name) => headers.set(name, value));
          }
          operation.signal.throwIfAborted();
          operation.close();
          const response = await base(request, {
            ...init,
            headers,
            redirect: "error",
            credentials: "omit"
          });
          try {
            if (response.redirected || response.status >= 300 && response.status < 400 || !response.ok)
              throw new Error("A2A HTTP request rejected");
            if (response.url)
              check(response.url);
          } catch {
            try {
              response.body?.cancel().catch(() => {});
            } catch {}
            throw new Error("A2A HTTP request rejected");
          }
          return response;
        } catch {
          throw new Error("A2A policy request failed");
        } finally {
          operation.close();
        }
      }, base);
    }
  };
}

// src/a2a-invoker.ts
class A2AInvocationError extends Error {
  submissionAttempted;
  messageId;
  task;
  cancellation;
  constructor(message, details = { submissionAttempted: false }) {
    super(message, { cause: details.cause });
    this.name = "A2AInvocationError";
    this.submissionAttempted = details.submissionAttempted;
    this.messageId = details.messageId;
    this.task = details.task;
    this.cancellation = details.cancellation;
  }
}

class A2AInvocationCancelledError extends A2AInvocationError {
  constructor(details = { submissionAttempted: false }) {
    super("A2A invocation was cancelled", details);
    this.name = "A2AInvocationCancelledError";
  }
}

class PollingA2AInvoker {
  clients;
  options;
  cancelTimeoutMs;
  constructor(clients, options) {
    this.clients = clients;
    this.options = options;
    this.cancelTimeoutMs = options.cancelTimeoutMs ?? 1000;
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || !Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs < 0 || !Number.isFinite(this.cancelTimeoutMs) || this.cancelTimeoutMs <= 0) {
      throw new Error("A2A operation budgets must be finite and positive (poll interval may be zero)");
    }
  }
  async invoke(input) {
    const operation = this.operation(input.signal, true, input.deadline);
    const execution = { submissionAttempted: false, identity: {} };
    try {
      const request = requestFor(input);
      execution.messageId = request.message?.messageId;
      execution.identity = {
        taskId: request.message?.taskId,
        contextId: request.message?.contextId
      };
      const client = await operation.run(() => this.clients(input.url, operation.signal));
      execution.client = client;
      const sent = await operation.run(() => {
        execution.submissionAttempted = true;
        return client.sendMessage(request, { signal: operation.signal });
      });
      if ("messageId" in sent) {
        checkIdentity(execution.identity, sent.taskId, sent.contextId, false);
        return sent;
      }
      let task = sent;
      while (true) {
        await this.accept(task, execution, operation, input);
        if (isStopped(task.status?.state))
          return task;
        await operation.run(() => sleep(this.options.pollIntervalMs, undefined, {
          signal: operation.signal
        }));
        task = await operation.run(() => client.getTask({ tenant: "", id: task.id, historyLength: undefined }, { signal: operation.signal }));
      }
    } catch (cause) {
      await this.cancelAccepted(execution, operation);
      throw failure(operation, execution, cause);
    } finally {
      operation.close();
    }
  }
  connect(url, signal) {
    return this.read(url, signal, (client) => client);
  }
  getTask(url, id, signal) {
    return this.read(url, signal, async (client, operation) => {
      const task = await client.getTask({ tenant: "", id, historyLength: undefined }, { signal: operation.signal });
      checkIdentity({ taskId: id }, task.id, task.contextId);
      return task;
    });
  }
  cancelTask(url, id, signal) {
    return this.read(url, signal, async (client, operation) => {
      const task = await client.cancelTask({ tenant: "", id, metadata: undefined }, { signal: operation.signal });
      checkIdentity({ taskId: id }, task.id, task.contextId);
      return task;
    });
  }
  stream(input) {
    return this.events(input.url, input.signal, input);
  }
  subscribe(url, id, signal) {
    return this.events(url, signal, undefined, id);
  }
  operation(signal, cleanup = false, deadline) {
    return new Operation(this.options.timeoutMs, signal, cleanup ? this.cancelTimeoutMs : 0, deadline);
  }
  async read(url, signal, work) {
    const operation = this.operation(signal);
    try {
      const client = await operation.run(() => this.clients(url, operation.signal));
      return await operation.run(() => work(client, operation));
    } catch (cause) {
      throw failure(operation, { submissionAttempted: false }, cause);
    } finally {
      operation.close();
    }
  }
  async accept(task, execution, operation, input) {
    pinIdentity(execution.identity, task.id, task.contextId);
    execution.task = task;
    execution.acceptedId = task.id;
    await operation.run(() => input?.onTask?.(task));
  }
  async cancelAccepted(execution, operation) {
    const { client, acceptedId } = execution;
    if (!client || !acceptedId)
      return;
    execution.cancellation = await operation.cleanup(async (signal) => {
      const task = await client.cancelTask({ tenant: "", id: acceptedId, metadata: undefined }, { signal });
      checkIdentity(execution.identity, task.id, task.contextId);
      return task;
    }, this.cancelTimeoutMs);
  }
  async* events(url, signal, input, id) {
    const operation = this.operation(signal, true, input?.deadline);
    const execution = {
      submissionAttempted: false,
      identity: { taskId: id }
    };
    let iterator;
    let complete = false;
    let stopped = false;
    let failed = false;
    try {
      const request = input ? requestFor(input) : undefined;
      execution.messageId = request?.message?.messageId;
      if (request)
        execution.identity = {
          taskId: request.message?.taskId,
          contextId: request.message?.contextId
        };
      const client = await operation.run(() => this.clients(url, operation.signal));
      execution.client = client;
      iterator = await operation.run(() => request ? client.sendMessageStream(request, { signal: operation.signal }) : client.resubscribeTask({ tenant: "", id }, { signal: operation.signal }));
      while (true) {
        const current = iterator;
        const next = await operation.run(() => {
          if (input)
            execution.submissionAttempted = true;
          return current.next();
        });
        if (next.done) {
          complete = true;
          return;
        }
        const payload = next.value.payload;
        if (payload?.$case === "task") {
          await this.accept(payload.value, execution, operation, input);
          stopped = isStopped(payload.value.status?.state);
        } else if (payload?.$case === "statusUpdate" || payload?.$case === "artifactUpdate") {
          pinIdentity(execution.identity, payload.value.taskId, payload.value.contextId);
          execution.acceptedId = payload.value.taskId;
          if (payload.$case === "statusUpdate")
            stopped = isStopped(payload.value.status?.state);
        } else if (payload?.$case === "message") {
          pinIdentity(execution.identity, payload.value.taskId, payload.value.contextId, false);
        }
        yield next.value;
      }
    } catch (cause) {
      failed = true;
      if (input)
        await this.cancelAccepted(execution, operation);
      throw failure(operation, execution, cause);
    } finally {
      if (input && !complete && !failed && !stopped)
        await this.cancelAccepted(execution, operation);
      operation.close();
      if (iterator) {
        const current = iterator;
        const closing = Promise.resolve().then(() => current.return());
        closing.catch(() => {});
        await operation.cleanup(() => closing, this.cancelTimeoutMs);
      }
    }
  }
}
function failure(operation, details, cause) {
  const context = { ...details, cause };
  if (operation.caller?.aborted)
    return new A2AInvocationCancelledError(context);
  return new A2AInvocationError(operation.signal.aborted ? "A2A operation timed out" : "A2A operation failed", context);
}
function requestFor(input) {
  const original = typeof input.message === "string" ? {
    messageId: crypto.randomUUID(),
    role: Role.ROLE_USER,
    contextId: "",
    taskId: "",
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
    parts: [
      {
        content: { $case: "text", value: input.message },
        mediaType: "text/plain",
        filename: "",
        metadata: undefined
      }
    ]
  } : input.message;
  if (input.contextId !== undefined && original.contextId && input.contextId !== original.contextId || input.taskId !== undefined && original.taskId && input.taskId !== original.taskId) {
    throw new Error("Conflicting explicit A2A message identity");
  }
  return {
    tenant: "",
    message: {
      ...original,
      contextId: input.contextId ?? original.contextId,
      taskId: input.taskId ?? original.taskId
    },
    configuration: {
      acceptedOutputModes: [],
      taskPushNotificationConfig: undefined,
      returnImmediately: true
    },
    metadata: undefined
  };
}
function checkIdentity(expected, taskId, contextId, requireTask = true) {
  if (requireTask && (!taskId || !contextId) || expected.taskId && expected.taskId !== taskId || expected.contextId && expected.contextId !== contextId) {
    throw new Error("A2A response identity conflicts with the operation");
  }
}
function pinIdentity(expected, taskId, contextId, requireTask = true) {
  checkIdentity(expected, taskId, contextId, requireTask);
  if (taskId)
    expected.taskId = taskId;
  if (contextId)
    expected.contextId = contextId;
}
function isStopped(state) {
  return state === TaskState.TASK_STATE_COMPLETED || state === TaskState.TASK_STATE_FAILED || state === TaskState.TASK_STATE_CANCELED || state === TaskState.TASK_STATE_REJECTED || state === TaskState.TASK_STATE_INPUT_REQUIRED || state === TaskState.TASK_STATE_AUTH_REQUIRED;
}
function createOfficialClientProvider(options = {}) {
  const baseFetch = options.fetchImpl ?? fetch;
  const policies = new Map(Object.entries(options.policies ?? {}).map(([url, policy]) => {
    const compiled = compilePolicy(policy);
    compiled.check(url);
    return [new URL(url).href, compiled];
  }));
  return async (url, signal) => {
    const policy = policies.get(new URL(url).href);
    const fetchImpl = policy?.fetch(baseFetch, options.discoveryTimeoutMs ?? 1e4) ?? baseFetch;
    const operation = new Operation(options.discoveryTimeoutMs ?? 1e4, signal);
    try {
      const origin = new URL(url);
      const check = (value) => {
        if (policy)
          return policy.check(value);
        const target = destination(value);
        if (!["http:", "https:"].includes(target.protocol) || target.origin !== origin.origin) {
          throw new Error("A2A endpoint must use the configured HTTP(S) origin");
        }
      };
      check(url);
      const transportFetch = Object.assign((request, init) => {
        check(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
        return fetchImpl(request, { ...init, redirect: "error" });
      }, fetchImpl);
      const discoveryFetch = Object.assign((request, init) => operation.run(() => transportFetch(request, {
        ...init,
        signal: operation.signal
      })), fetchImpl);
      const resolver = new DefaultAgentCardResolver({
        fetchImpl: discoveryFetch
      });
      const factory = new ClientFactory({
        transports: [
          new JsonRpcTransportFactory({ fetchImpl: transportFetch })
        ],
        cardResolver: {
          resolve: async (base, path) => {
            const card = await resolver.resolve(base, path);
            for (const endpoint of card.supportedInterfaces)
              check(endpoint.url);
            return card;
          }
        }
      });
      const client = await operation.run(() => factory.createFromUrl(url));
      const getCard = client.getAgentCard.bind(client);
      client.getAgentCard = async (...args) => {
        const card = await getCard(...args);
        for (const endpoint of card.supportedInterfaces)
          check(endpoint.url);
        return card;
      };
      return client;
    } catch (cause) {
      throw failure(operation, { submissionAttempted: false }, cause);
    } finally {
      operation.close();
    }
  };
}

// src/config.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
function loadConfig(environment = process.env, home = homedir()) {
  const configPath = environment.LETTA_A2A_CONFIG ?? join(home, ".letta", "a2a-client.json");
  let raw = {};
  if (existsSync(configPath)) {
    raw = parseJson(readFileSync(configPath, "utf8"), configPath);
  } else if (!environment.LETTA_A2A_ROUTES) {
    throw new Error(`A2A routes are not configured. Create ${configPath} or set LETTA_A2A_ROUTES.`);
  }
  if (environment.LETTA_A2A_ROUTES) {
    raw.routes = parseJson(environment.LETTA_A2A_ROUTES, "LETTA_A2A_ROUTES");
  }
  if (environment.LETTA_A2A_CONTEXT_STORE) {
    raw.contextStorePath = environment.LETTA_A2A_CONTEXT_STORE;
  }
  return parseConfig(raw, home);
}
function parseConfig(raw, home) {
  if (!isRecord(raw))
    throw new Error("A2A configuration must be a JSON object");
  if (!isRecord(raw.routes) || Object.keys(raw.routes).length === 0) {
    throw new Error("A2A configuration must contain at least one route");
  }
  const routes = Object.create(null);
  for (const [target, value] of Object.entries(raw.routes)) {
    if (!/^[A-Za-z0-9._-]+$/.test(target)) {
      throw new Error(`A2A route name ${JSON.stringify(target)} is invalid`);
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`A2A route ${JSON.stringify(target)} must be a URL string`);
    }
    routes[target] = normalizeRouteUrl(target, value);
  }
  const contextStorePath = readOptionalString(raw.contextStorePath, "contextStorePath");
  return {
    routes,
    pollIntervalMs: readInteger(raw.pollIntervalMs, 500, 50, 5000, "pollIntervalMs"),
    timeoutMs: readInteger(raw.timeoutMs, 120000, 1000, 600000, "timeoutMs"),
    contextStorePath: contextStorePath ? isAbsolute(contextStorePath) ? contextStorePath : resolve(home, contextStorePath) : join(home, ".letta", "a2a-client-contexts.json")
  };
}
function normalizeRouteUrl(target, raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`A2A route ${JSON.stringify(target)} is not a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`A2A route ${JSON.stringify(target)} must use http or https`);
  }
  if (url.username || url.password) {
    throw new Error(`A2A route ${JSON.stringify(target)} must not contain credentials`);
  }
  if (url.search || url.hash) {
    throw new Error(`A2A route ${JSON.stringify(target)} must not contain a query or fragment`);
  }
  return url.href.replace(/\/$/, "");
}
function readInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined)
    return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
function readOptionalString(value, name) {
  if (value === undefined)
    return;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}
function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// src/context-store.ts
import { createHash as createHash2, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join as join2 } from "node:path";
import { setTimeout as sleep2 } from "node:timers/promises";
var WRITE_LOCK_WAIT_MS = 5000;

class MemoryContextStore {
  values = new Map;
  tails = new Map;
  async get(key) {
    return this.values.get(key);
  }
  async set(key, value) {
    this.values.set(key, value);
  }
  async withLock(key, signal, work) {
    signal.throwIfAborted();
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);
    tail.then(() => {
      if (this.tails.get(key) === tail)
        this.tails.delete(key);
    });
    let onAbort;
    const canceled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([previous, canceled]);
      signal.throwIfAborted();
      return await work();
    } finally {
      signal.removeEventListener("abort", onAbort);
      release();
    }
  }
}

class FileContextStore {
  path;
  constructor(path) {
    this.path = path;
  }
  async get(key) {
    return (await this.read())[key];
  }
  async withLock(key, signal, work) {
    signal.throwIfAborted();
    const directory = `${this.path}.locks`;
    await mkdir(directory, { recursive: true });
    const hash = createHash2("sha256").update(key).digest("hex");
    const release = await acquireFileLock(join2(directory, `${hash}.lock`), signal);
    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      await release();
    }
  }
  async set(key, value) {
    await mkdir(dirname(this.path), { recursive: true });
    const release = await acquireFileLock(`${this.path}.lock`, AbortSignal.timeout(WRITE_LOCK_WAIT_MS));
    try {
      const current = await this.read();
      current[key] = value;
      const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(current, null, 2)}
`, {
          encoding: "utf8",
          mode: 384
        });
        await rename(temporary, this.path);
      } catch (error) {
        await unlink(temporary).catch(() => {
          return;
        });
        throw error;
      }
    } finally {
      await release();
    }
  }
  async read() {
    let text;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT")
        return Object.create(null);
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${this.path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord2(parsed)) {
      throw new Error(`${this.path} must contain a JSON object`);
    }
    const result = Object.create(null);
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        throw new Error(`${this.path} contains an invalid context for ${key}`);
      }
      result[key] = value;
    }
    return result;
  }
}
async function acquireFileLock(path, signal) {
  while (true) {
    if (signal.aborted)
      throw lockWaitError(path, signal);
    let handle;
    try {
      handle = await open(path, "wx", 384);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST")
        throw error;
      try {
        await sleep2(20, undefined, { signal });
      } catch (error) {
        if (signal.aborted)
          throw lockWaitError(path, signal);
        throw error;
      }
      continue;
    }
    const token = `${process.pid}:${randomUUID()}`;
    const release = async () => {
      let currentToken;
      try {
        currentToken = (await readFile(path, "utf8")).trim();
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
          return;
        throw error;
      }
      if (currentToken === token)
        await unlink(path);
    };
    try {
      await handle.writeFile(`${token}
`, "utf8");
    } catch (error) {
      await release().catch(() => {
        return;
      });
      throw new Error(`Could not initialize lock ${path}; ${RECOVERY_NOTE}`, {
        cause: error
      });
    } finally {
      await handle.close();
    }
    return release;
  }
}
var RECOVERY_NOTE = "manual recovery: only remove this lock after confirming no process is using it; locks are never automatically reclaimed";
function lockWaitError(path, signal) {
  const reason = signal.reason instanceof Error ? signal.reason.message : String(signal.reason);
  return new Error(`Context-store lock wait canceled for ${path}: ${reason}; ${RECOVERY_NOTE}`, {
    cause: signal.reason
  });
}
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// src/tool-service.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var bindingKey = (scope, url) => JSON.stringify(["a2a-binding", scope, url]);
var executionKey = (url, context) => JSON.stringify(["a2a-execution", url, context]);
var terminal = (state) => state === TaskState.TASK_STATE_COMPLETED || state === TaskState.TASK_STATE_FAILED || state === TaskState.TASK_STATE_CANCELED || state === TaskState.TASK_STATE_REJECTED;
var interrupted = (state) => state === TaskState.TASK_STATE_INPUT_REQUIRED || state === TaskState.TASK_STATE_AUTH_REQUIRED;

class A2AToolService {
  routes;
  invoker;
  contexts;
  closed = new AbortController;
  owners = new WeakMap;
  timeoutMs;
  identities;
  storageEndpoint(url) {
    return this.identities[url] ? JSON.stringify(["a2a-policy", url, this.identities[url]]) : url;
  }
  constructor(routes, invoker, contexts, options = {}) {
    this.routes = routes;
    this.invoker = invoker;
    this.contexts = contexts;
    this.identities = Object.freeze({ ...options.identities });
    this.timeoutMs = options.timeoutMs ?? 120000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0)
      throw new Error("A2A timeoutMs must be positive and finite");
  }
  targets() {
    return Object.keys(this.routes).sort();
  }
  connect(target, signal) {
    return this.operation(signal, {}, (s) => this.invoker.connect(this.endpoint(target), s));
  }
  close() {
    this.closed.abort(new Error("A2A service closed"));
  }
  async drain(signal) {
    await Promise.allSettled([...this.owners.get(signal) ?? []]);
  }
  task(input) {
    return this.operation(input.signal, {}, async (signal) => {
      const url = this.endpoint(input.target);
      if (!input.taskId)
        throw new Error("A2A taskId is required");
      if (input.action !== "get" && input.action !== "cancel")
        throw new Error("Invalid A2A task action");
      const binding = await this.load(bindingKey(input.localScope, this.storageEndpoint(url)));
      signal.throwIfAborted();
      const result = await (input.action === "get" ? this.invoker.getTask(url, input.taskId, signal) : this.invoker.cancelTask(url, input.taskId, signal));
      this.check(result, input.taskId, binding.taskId === input.taskId ? binding.contextId : undefined);
      return result;
    });
  }
  invoke(input) {
    const details = { submissionAttempted: false };
    return this.operation(input.signal, details, async (signal, deadline) => {
      const url = this.endpoint(input.target);
      if (typeof input.message === "string" && !input.message.trim())
        throw new Error("A2A message is required");
      const message = typeof input.message === "string" ? {
        messageId: randomUUID2(),
        role: Role.ROLE_USER,
        contextId: "",
        taskId: "",
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
        parts: [
          {
            content: { $case: "text", value: input.message.trim() },
            mediaType: "text/plain",
            filename: "",
            metadata: undefined
          }
        ]
      } : {
        ...input.message,
        messageId: input.message.messageId || randomUUID2()
      };
      if (input.contextId && message.contextId && input.contextId !== message.contextId || input.taskId && message.taskId && input.taskId !== message.taskId)
        throw new Error("Conflicting explicit A2A message identity");
      const explicitContext = input.contextId || message.contextId || undefined;
      const taskId = input.taskId || message.taskId || undefined;
      if (input.newContext && (explicitContext || taskId))
        throw new Error("new_context cannot be combined with context_id or task_id");
      const key = bindingKey(input.localScope, this.storageEndpoint(url));
      return this.contexts.withLock(key, signal, async () => {
        const binding = await this.load(key);
        this.requireReadback(binding);
        if (!binding.contextId && !explicitContext && !input.newContext) {
          const legacy = await this.contexts.get(`${input.localScope}/${input.target}`);
          if (legacy)
            throw new A2AInvocationError(`Legacy A2A context ${JSON.stringify(legacy)} has no endpoint identity. Supply context_id explicitly to migrate it, or new_context to start independently; the legacy entry is preserved.`);
        }
        let contextId = explicitContext ?? (input.newContext ? undefined : binding.contextId);
        if (taskId) {
          signal.throwIfAborted();
          const found = await this.invoker.getTask(url, taskId, signal);
          this.check(found, taskId, contextId);
          contextId = found.contextId;
        }
        if (contextId) {
          return this.contexts.withLock(executionKey(this.storageEndpoint(url), contextId), signal, () => this.send(message, url, key, contextId, taskId, signal, details, binding, deadline));
        }
        return this.send(message, url, key, undefined, taskId, signal, details, binding, deadline);
      });
    });
  }
  async send(message, url, key, contextId, taskId, signal, details, binding, deadline) {
    let record = contextId ? await this.load(executionKey(this.storageEndpoint(url), contextId)) : {};
    if (contextId === binding.contextId && (binding.pending && !record.pending || binding.taskId && binding.messageId === record.messageId && (!record.taskId || record.submissionUnknown && !binding.submissionUnknown)))
      record = binding;
    this.requireReadback(record);
    if (record.taskId && !terminal(record.state)) {
      signal.throwIfAborted();
      const current = await this.invoker.getTask(url, record.taskId, signal);
      this.check(current, record.taskId, contextId);
      record = this.snapshot(current, record.messageId);
      await this.save(executionKey(this.storageEndpoint(url), contextId), record);
      if (!terminal(record.state) && !(interrupted(record.state) && taskId === record.taskId)) {
        throw new Error(interrupted(record.state) ? `A2A task ${record.taskId} requires same-task followup; supply task_id.` : `A2A task ${record.taskId} is still working or unresolved; use task get/cancel before sending again.`);
      }
    }
    if (taskId) {
      signal.throwIfAborted();
      const current = await this.invoker.getTask(url, taskId, signal);
      this.check(current, taskId, contextId);
      if (terminal(current.status?.state))
        throw new Error(`Cannot continue terminal A2A task ${taskId}`);
      if (!interrupted(current.status?.state))
        throw new Error(`A2A task ${taskId} is still working or unresolved`);
    }
    const previous = record;
    record = {
      contextId,
      taskId,
      messageId: message.messageId,
      pending: true,
      submissionUnknown: true
    };
    details.messageId = message.messageId;
    await this.save(key, record);
    if (contextId)
      await this.save(executionKey(this.storageEndpoint(url), contextId), record);
    let accepted;
    let releaseContext;
    let contextLease;
    let lockedContext = contextId;
    let persistence = Promise.resolve();
    let callbacksOpen = true;
    let acceptanceObserved = false;
    const writeTask = async (task, acceptance) => {
      this.check(task, accepted?.id ?? taskId, contextId ?? accepted?.contextId);
      accepted = task;
      details.task = task;
      acceptanceObserved ||= acceptance;
      record = {
        ...this.snapshot(task, message.messageId),
        submissionUnknown: !acceptanceObserved
      };
      await this.save(key, record);
      if (!lockedContext) {
        let ready;
        let failed;
        const acquired = new Promise((resolve, reject) => {
          ready = resolve;
          failed = reject;
        });
        const hold = new Promise((resolve) => {
          releaseContext = resolve;
        });
        contextLease = this.contexts.withLock(executionKey(this.storageEndpoint(url), task.contextId), signal, async () => {
          lockedContext = task.contextId;
          ready();
          await hold;
        });
        contextLease.catch(failed);
        await acquired;
      }
      await this.save(executionKey(this.storageEndpoint(url), task.contextId), record);
    };
    const persistTask = (task, acceptance = false) => {
      const update = persistence.then(() => writeTask(task, acceptance));
      persistence = update.catch(() => {
        return;
      });
      return update;
    };
    const onTask = (task) => {
      if (!callbacksOpen)
        return Promise.reject(new Error("A2A acceptance callback arrived after invocation settlement"));
      return persistTask(task, true);
    };
    try {
      signal.throwIfAborted();
      details.submissionAttempted = true;
      const result = await this.invoker.invoke({
        url,
        message,
        contextId,
        taskId,
        signal,
        deadline,
        onTask
      });
      callbacksOpen = false;
      await persistence;
      if ("messageId" in result) {
        if (contextId && result.contextId !== contextId || taskId && result.taskId !== taskId)
          throw new Error("A2A message response identity mismatch");
        const completed = {
          contextId: result.contextId || contextId,
          pending: false
        };
        await this.save(key, completed);
        if (completed.contextId) {
          if (lockedContext)
            await this.save(executionKey(this.storageEndpoint(url), completed.contextId), completed);
          else
            await this.contexts.withLock(executionKey(this.storageEndpoint(url), completed.contextId), signal, () => this.save(executionKey(this.storageEndpoint(url), completed.contextId), completed));
        }
      } else
        await persistTask(result, true);
      return result;
    } catch (error) {
      callbacksOpen = false;
      await persistence;
      if (error instanceof A2AInvocationError) {
        if (error.task)
          await persistTask(error.task);
        if (error.cancellation)
          await persistTask(error.cancellation);
        if (!error.submissionAttempted && !accepted) {
          await this.save(key, binding);
          if (contextId)
            await this.save(executionKey(this.storageEndpoint(url), contextId), previous);
        }
        const failure = {
          ...details,
          submissionAttempted: error.submissionAttempted,
          messageId: error.messageId ?? details.messageId,
          task: accepted ?? error.task,
          cancellation: error.cancellation,
          cause: error
        };
        throw error instanceof A2AInvocationCancelledError ? new A2AInvocationCancelledError(failure) : new A2AInvocationError(error.message, failure);
      }
      throw new A2AInvocationError(error instanceof Error ? error.message : "A2A invocation failed", { ...details, cause: error });
    } finally {
      callbacksOpen = false;
      await persistence;
      releaseContext?.();
      await contextLease?.catch(() => {
        return;
      });
    }
  }
  endpoint(target) {
    const route = Object.hasOwn(this.routes, target) ? this.routes[target] : undefined;
    if (!route)
      throw new Error(`Unknown A2A target ${JSON.stringify(target)}. Configured targets: ${this.targets().join(", ")}`);
    const url = new URL(route);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("A2A endpoint must use HTTP(S)");
    if (url.username || url.password)
      throw new Error("A2A endpoint must not contain credentials");
    url.hash = "";
    return url.href;
  }
  async load(key) {
    const value = await this.contexts.get(key);
    if (value === undefined)
      return {};
    const record = JSON.parse(value);
    if (!record || typeof record !== "object" || Array.isArray(record))
      throw new Error("Invalid A2A controller record; inspect the context store before retrying");
    const fields = record;
    if (["contextId", "taskId", "messageId"].some((name) => fields[name] !== undefined && typeof fields[name] !== "string") || fields.pending !== undefined && typeof fields.pending !== "boolean" || fields.submissionUnknown !== undefined && typeof fields.submissionUnknown !== "boolean" || fields.state !== undefined && (typeof fields.state !== "number" || !Object.values(TaskState).includes(fields.state))) {
      throw new Error("Invalid A2A controller metadata; inspect the context store before retrying");
    }
    return record;
  }
  save(key, record) {
    return this.contexts.set(key, JSON.stringify(record));
  }
  requireReadback(record) {
    if (record.submissionUnknown || record.pending && (!record.taskId || record.state === undefined)) {
      throw new A2AInvocationError(`Unknown A2A submission ${record.messageId ?? "(missing message ID)"}${record.taskId ? ` for task ${record.taskId}` : " has no task readback ID"}. Do not retry automatically or erase it with new_context. An unchanged task state does not acknowledge this message. Have the peer/operator correlate this exact message ID and explicitly reconcile the controller record before retrying.`, { submissionAttempted: false, messageId: record.messageId });
    }
  }
  snapshot(task, messageId) {
    return {
      contextId: task.contextId,
      taskId: task.id,
      state: task.status?.state,
      messageId,
      pending: !terminal(task.status?.state)
    };
  }
  check(task, taskId, contextId) {
    if (!task.id || !task.contextId || taskId && task.id !== taskId || contextId && task.contextId !== contextId) {
      throw new Error("A2A task/context identity mismatch in remote readback");
    }
  }
  async operation(caller, details, work) {
    const deadline = performance.now() + this.timeoutMs;
    const controller = new AbortController;
    const relay = () => controller.abort(caller?.aborted ? caller.reason : this.closed.signal.reason);
    const sources = [caller, this.closed.signal].filter((s) => !!s);
    for (const source of sources) {
      source.addEventListener("abort", relay, { once: true });
      if (source.aborted)
        relay();
    }
    const timer = setTimeout(() => controller.abort(new Error("A2A operation timed out")), this.timeoutMs);
    let abort;
    const canceled = new Promise((_, reject) => {
      abort = () => {
        const context = {
          submissionAttempted: false,
          ...details,
          cause: controller.signal.reason
        };
        reject(caller?.aborted || this.closed.signal.aborted ? new A2AInvocationCancelledError(context) : new A2AInvocationError("A2A operation timed out", context));
      };
      controller.signal.addEventListener("abort", abort, { once: true });
      if (controller.signal.aborted)
        abort();
    });
    const pending = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal, deadline);
    });
    if (caller) {
      const owned = this.owners.get(caller) ?? new Set;
      this.owners.set(caller, owned);
      owned.add(pending);
      const settled = () => {
        owned.delete(pending);
        if (owned.size === 0)
          this.owners.delete(caller);
      };
      pending.then(settled, settled);
    }
    try {
      return await Promise.race([canceled, pending]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
      for (const source of sources)
        source.removeEventListener("abort", relay);
    }
  }
}

// src/index.ts
function createA2AClient(options) {
  const { routes } = parseConfig({ routes: options.routes }, ".");
  const timeoutMs = positiveInteger(options.timeoutMs ?? 120000, "timeoutMs");
  const pollIntervalMs = positiveInteger(options.pollIntervalMs ?? 500, "pollIntervalMs");
  const cancelTimeoutMs = positiveInteger(options.cancelTimeoutMs ?? 5000, "cancelTimeoutMs");
  const policies = {};
  const identities = {};
  const seen = new Map;
  for (const alias of Object.keys(options.routePolicies ?? {}))
    if (!(alias in routes))
      throw new Error("Policy references an unknown A2A route");
  for (const [alias, url] of Object.entries(routes)) {
    const policy = options.routePolicies?.[alias];
    const compiled = policy ? compilePolicy(policy) : undefined;
    compiled?.check(url);
    const previous = seen.get(url);
    if (seen.has(url) && (previous?.signature !== compiled?.signature || previous?.provide !== compiled?.provide))
      throw new Error("Conflicting same-URL A2A alias policies; use separate client instances");
    seen.set(url, compiled);
    if (policy && compiled) {
      policies[url] = policy;
      identities[new URL(url).href] = compiled.identity;
    }
  }
  return new A2AToolService(routes, new PollingA2AInvoker(createOfficialClientProvider({ policies }), {
    timeoutMs,
    pollIntervalMs,
    cancelTimeoutMs
  }), options.contextStore ?? new MemoryContextStore, { timeoutMs, identities });
}
function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) {
    throw new Error(`${name} must be a positive timer-safe integer`);
  }
  return value;
}

// src/tool-operations.ts
var stringSchema = { type: "string", minLength: 1 };
var A2A_TOOL_DEFINITIONS = [
  {
    name: "a2a_invoke",
    description: "Send a message to a configured remote A2A agent. Reuses this conversation's remote context; use task_id for same-task followup. Working or interrupted results can be inspected with a2a_task.",
    parameters: {
      type: "object",
      properties: {
        target: stringSchema,
        message: stringSchema,
        context_id: stringSchema,
        task_id: stringSchema,
        new_context: { type: "boolean" }
      },
      required: ["target", "message"],
      additionalProperties: false
    },
    requiresApproval: true,
    parallelSafe: false
  },
  {
    name: "a2a_task",
    description: "Read or request cancellation of a known remote A2A task. Cancellation is confirmed only when the returned state is canceled.",
    parameters: {
      type: "object",
      properties: {
        target: stringSchema,
        task_id: stringSchema,
        action: { type: "string", enum: ["get", "cancel"] }
      },
      required: ["target", "task_id", "action"],
      additionalProperties: false
    },
    requiresApproval: true,
    parallelSafe: false
  }
];
function getA2AToolDefinitions(client) {
  const targets = [...client.targets()].sort();
  return A2A_TOOL_DEFINITIONS.map((definition) => ({
    ...definition,
    description: `${definition.description} Configured targets: ${targets.join(", ") || "none configured"}.`,
    parameters: {
      ...definition.parameters,
      properties: {
        ...definition.parameters.properties,
        target: {
          ...stringSchema,
          ...targets.length ? { enum: targets } : {}
        }
      }
    }
  }));
}

class ArgumentError extends Error {
}
function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim())
    throw new ArgumentError(`${name} must be a non-empty string`);
  return value;
}
function optionalString(args, name) {
  return Object.hasOwn(args, name) ? requiredString(args[name], name) : undefined;
}
function resolveA2AScope(getScope) {
  const scope = getScope();
  const agent = requiredString(scope?.agentId, "Trusted agentId (session must be ready)");
  const conversation = requiredString(scope?.conversationId, "Trusted conversationId (session must be ready)");
  if (agent.includes("/") || conversation.includes("/"))
    throw new ArgumentError("Trusted scope IDs must not contain slashes");
  return `${agent}/${conversation}`;
}
function readA2AArguments(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ArgumentError("Arguments must be an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new ArgumentError("Arguments must be a plain object");
  const args = value;
  const allowed = name === "a2a_invoke" ? ["target", "message", "context_id", "task_id", "new_context"] : ["target", "task_id", "action"];
  if (Reflect.ownKeys(args).some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw new ArgumentError("Unknown A2A argument; scope and identity are host-owned");
  const target = requiredString(args.target, "target");
  if (name === "a2a_task") {
    const taskId = requiredString(args.task_id, "task_id");
    if (args.action !== "get" && args.action !== "cancel")
      throw new ArgumentError("action must be get or cancel");
    const action = args.action;
    return { kind: "task", target, taskId, action };
  }
  const message = requiredString(args.message, "message");
  const contextId = optionalString(args, "context_id");
  const taskId = optionalString(args, "task_id");
  if (Object.hasOwn(args, "new_context") && typeof args.new_context !== "boolean")
    throw new ArgumentError("new_context must be a boolean");
  const newContext = args.new_context;
  if (newContext && (contextId || taskId))
    throw new ArgumentError("new_context cannot be combined with context_id or task_id");
  return {
    kind: "invoke",
    target,
    message,
    contextId,
    taskId,
    newContext
  };
}
var states = {
  [TaskState.TASK_STATE_UNSPECIFIED]: "unspecified",
  [TaskState.TASK_STATE_SUBMITTED]: "submitted",
  [TaskState.TASK_STATE_WORKING]: "working",
  [TaskState.TASK_STATE_COMPLETED]: "completed",
  [TaskState.TASK_STATE_FAILED]: "failed",
  [TaskState.TASK_STATE_CANCELED]: "canceled",
  [TaskState.TASK_STATE_INPUT_REQUIRED]: "input-required",
  [TaskState.TASK_STATE_REJECTED]: "rejected",
  [TaskState.TASK_STATE_AUTH_REQUIRED]: "auth-required"
};
var stateName = (task) => states[task.status?.state ?? 0] ?? "unknown";
var failed = (task) => ["failed", "canceled", "rejected"].includes(stateName(task));
var clip = (text, limit) => text.length <= limit ? text : `${text.slice(0, limit)}…[truncated ${text.length - limit} chars]`;
function dataSummary(value) {
  if (value === null)
    return { type: "null" };
  if (Array.isArray(value))
    return { type: "array", items: value.length, valuesOmitted: true };
  if (typeof value === "object")
    return {
      type: "object",
      properties: Object.keys(value).length,
      valuesOmitted: true
    };
  return {
    type: typeof value,
    ...typeof value === "string" ? { characters: value.length } : {},
    valueOmitted: true
  };
}
function dataPreview(value, limit) {
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 40)
      return "[omitted: preview node budget]";
    if (item === null || typeof item === "boolean")
      return item;
    if (typeof item === "number")
      return Number.isFinite(item) ? item : "[omitted: non-JSON number]";
    if (typeof item === "string")
      return "[omitted: unclassified string value]";
    if (depth >= 3)
      return "[omitted: preview depth limit]";
    if (Array.isArray(item)) {
      const preview = item.slice(0, 8).map((entry) => visit(entry, depth + 1));
      if (item.length > 8)
        preview.push(`[omitted: ${item.length - 8} array items]`);
      return preview;
    }
    if (item && typeof item === "object" && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
      const entries = Object.entries(item);
      const preview = {};
      let omitted = Math.max(0, entries.length - 8);
      for (const [key, entry] of entries.slice(0, 8)) {
        if (["__proto__", "constructor", "prototype"].includes(key) || !/^[A-Za-z_][A-Za-z0-9_-]{0,47}$/.test(key) || /secret|password|token|auth|credential|cookie|header|metadata|reason|thought|base64|raw|private|key/i.test(key)) {
          omitted++;
          continue;
        }
        preview[key] = visit(entry, depth + 1);
      }
      if (omitted)
        preview.$omittedProperties = omitted;
      return preview;
    }
    return "[omitted: non-JSON value]";
  }
  const preview = visit(value, 0);
  return JSON.stringify(preview).length <= Math.min(limit, 1000) ? { preview } : { previewOmitted: "JSON preview exceeds size budget" };
}
function fileUrl(value, limit) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      return "[URL omitted: non-HTTP scheme]";
    url.username = "";
    url.password = "";
    return clip(url.toString(), limit);
  } catch {
    return "[URL omitted: invalid URL]";
  }
}
function previewParts(parts, limit, count) {
  return {
    parts: parts.slice(0, count).map((part) => {
      const common = {
        filename: clip(part.filename, limit),
        mediaType: clip(part.mediaType, limit)
      };
      const content = part.content;
      switch (content?.$case) {
        case "text":
          return { type: "text", text: clip(content.value, limit) };
        case "data":
          return {
            type: "data",
            ...common,
            summary: dataSummary(content.value),
            ...dataPreview(content.value, limit)
          };
        case "raw":
          return {
            type: "file",
            ...common,
            byteCount: content.value.byteLength,
            bytesOmitted: true
          };
        case "url":
          return {
            type: "file",
            ...common,
            url: fileUrl(content.value, limit)
          };
        default:
          return { type: "unknown", contentOmitted: true };
      }
    }),
    ...parts.length > count ? { omittedParts: parts.length - count } : {}
  };
}
function previewMessage(message, limit, count) {
  return {
    messageId: clip(message.messageId, limit),
    text: clip(message.parts.slice(0, count).flatMap((part) => part.content?.$case === "text" ? [part.content.value.slice(0, limit + 1)] : []).join(`
`), limit),
    ...previewParts(message.parts, limit, count)
  };
}
function projection(target, result, limit, count) {
  if (!("id" in result))
    return {
      target: clip(target, limit),
      status: "message",
      taskId: clip(result.taskId, limit),
      contextId: clip(result.contextId, limit),
      ...previewMessage(result, limit, count)
    };
  return {
    target: clip(target, limit),
    status: stateName(result),
    taskId: clip(result.id, limit),
    contextId: clip(result.contextId, limit),
    text: clip(result.artifacts.slice(0, count).flatMap((artifact) => artifact.parts.slice(0, count).flatMap((part) => part.content?.$case === "text" ? [part.content.value.slice(0, limit + 1)] : [])).join(`
`), limit),
    ...result.status?.message ? { statusMessage: previewMessage(result.status.message, limit, count) } : {},
    artifacts: result.artifacts.slice(0, count).map((artifact) => ({
      artifactId: clip(artifact.artifactId, limit),
      name: clip(artifact.name, limit),
      ...previewParts(artifact.parts, limit, count)
    })),
    ...result.artifacts.length > count ? { omittedArtifacts: result.artifacts.length - count } : {},
    ...result.history.length ? { omittedHistoryMessages: result.history.length } : {}
  };
}
function projectA2AResult(target, result) {
  return {
    content: boundedProjection(target, result),
    isError: "id" in result && failed(result)
  };
}
function boundedProjection(target, result, extra = {}) {
  for (const [limit, count] of [
    [2000, 12],
    [800, 8],
    [300, 4],
    [100, 2]
  ]) {
    const content = JSON.stringify({
      ...result ? projection(target, result, limit, count) : { target: clip(target, limit), status: "error" },
      ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [
        key,
        typeof value === "string" ? clip(value, limit) : value
      ]))
    });
    if (content.length <= 16000)
      return content;
  }
  return JSON.stringify({
    target: clip(target, 100),
    status: "error",
    contentOmitted: true,
    error: "Projection exceeded output budget"
  });
}
async function runA2ATool(name, args, options) {
  let target = "";
  let action;
  let readback = {};
  try {
    const input = readA2AArguments(name, args);
    target = input.target;
    readback = {
      taskId: input.taskId,
      contextId: input.kind === "invoke" ? input.contextId : undefined
    };
    const localScope = resolveA2AScope(options.getScope);
    if (options.signal.aborted)
      throw new ArgumentError("A2A tool owner is closed or canceled; no new submission attempted");
    if (input.kind === "task") {
      action = input.action;
      const result = await options.client.task({
        target,
        taskId: input.taskId,
        action,
        localScope,
        signal: options.signal
      });
      return {
        content: boundedProjection(target, result, action === "cancel" ? {
          cancellation: stateName(result) === "canceled" ? "confirmed" : "requested-not-confirmed"
        } : {}),
        isError: failed(result)
      };
    }
    const result = await options.client.invoke({
      target,
      message: input.message,
      contextId: input.contextId,
      taskId: input.taskId,
      newContext: input.newContext,
      localScope,
      signal: options.signal
    });
    return projectA2AResult(target, result);
  } catch (error) {
    if (error instanceof A2AInvocationError) {
      return {
        isError: true,
        content: boundedProjection(target, error.task, {
          ...!error.task ? readback : {},
          error: clip(error.message, 2000),
          submissionAttempted: error.submissionAttempted,
          ...error.messageId ? { messageId: clip(error.messageId, 300) } : {},
          ...error.cancellation ? {
            cancellation: stateName(error.cancellation) === "canceled" ? "confirmed" : "requested-not-confirmed",
            cancellationTaskId: clip(error.cancellation.id, 300),
            cancellationContextId: clip(error.cancellation.contextId, 300),
            cancellationStatus: stateName(error.cancellation)
          } : { cancellation: "not-confirmed" }
        })
      };
    }
    return {
      isError: true,
      content: boundedProjection(target, undefined, {
        ...readback,
        error: error instanceof ArgumentError ? clip(error.message, 2000) : "A2A operation failed; inspect the known task before retrying",
        ...action === "cancel" ? { cancellation: "not-confirmed" } : {}
      })
    };
  }
}

// src/mod-controller.ts
class A2AModController {
  client;
  constructor(client) {
    this.client = client;
  }
  async run(name, context) {
    const result = await runA2ATool(name, context.args, {
      client: this.client,
      getScope: () => ({
        agentId: context.agent.id,
        conversationId: context.conversation.id
      }),
      signal: context.signal
    });
    return result.isError ? { status: "error", content: result.content } : result.content;
  }
  targets() {
    return this.client.targets();
  }
}

// mods/a2a-client.ts
function activate(letta) {
  if (!letta.capabilities.tools)
    return;
  const owner = new AbortController;
  let client;
  let controller;
  let configurationError;
  try {
    const config = loadConfig();
    client = createA2AClient({
      routes: config.routes,
      timeoutMs: config.timeoutMs,
      pollIntervalMs: config.pollIntervalMs,
      contextStore: new FileContextStore(config.contextStorePath)
    });
    controller = new A2AModController(client);
  } catch (error) {
    configurationError = error instanceof Error ? error.message : "Invalid A2A configuration";
    letta.diagnostics.report({
      message: `A2A tools unavailable: ${configurationError}`,
      severity: "error"
    });
  }
  const unregister = [];
  let closed = false;
  const cleanup = () => {
    if (closed)
      return;
    closed = true;
    owner.abort();
    client?.close();
    for (const remove of unregister.reverse()) {
      try {
        remove();
      } catch {
        letta.diagnostics.report({
          message: "Failed to unregister an A2A tool",
          severity: "error"
        });
      }
    }
  };
  try {
    for (const definition of getA2AToolDefinitions(client ?? { targets: () => [] })) {
      unregister.push(letta.tools.register({
        ...definition,
        async run(context) {
          if (!controller)
            return {
              status: "error",
              content: configurationError ?? "A2A client is not configured"
            };
          return controller.run(definition.name, {
            ...context,
            signal: AbortSignal.any([owner.signal, context.signal])
          });
        }
      }));
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}
export {
  activate as default
};
