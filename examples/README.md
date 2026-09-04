# A2A Examples Roadmap

This directory is the learning path and implementation roadmap for the repository. Examples 01–11 teach A2A concepts using the shared Docker lab, which contains Letta agents and an independently implemented A2A agent. Planned examples may add profile-gated Docker services for concrete cross-runtime use cases without changing that primary stack.

The external reference agent happens to be written in Python, but the examples describe it as an external A2A agent. Its language and framework are implementation details; any conforming agent should be able to take its place.

## Principles

- Use two agents per scenario. Multi-agent orchestration is a separate topic.
- Keep every service Dockerized on one host so the repository remains easy to run.
- Teach protocol behavior rather than product-specific tricks.
- Add one capability at a time. Keep earlier conceptual examples runnable against the current stack; when a security stage is intentionally superseded, retain its exact Git checkpoint.
- Use deterministic protocol fixtures where possible; label model-backed demonstrations as live tests.
- Include exact commands, expected output, and a way to observe each interaction.
- Create an example subfolder only when its README and behavior are ready. Do not add empty placeholders.

## Gateway decision

The gateway checkpoint is complete. [agentgateway](https://agentgateway.dev/docs/standalone/latest/agent/a2a/) v1.5.0 passed the existing discovery, messaging, context, delegation, failure, and cancellation matrix through one shared process and replaced the three LiteLLM lanes.

The evaluation proved:

- A2A 1.0 Agent Card and request compatibility for the tested JSON-RPC paths.
- Asynchronous task creation and polling.
- Letta-to-external-agent nested delegation without gateway re-entry deadlock.
- Cancellation propagation and stable terminal states.
- Strict edge authentication, preservation of the tested card fields, rewriting of the tested A2A 1.0 interface URL, a reachable UI, and richer structured A2A logs. Examples 07 and 08 subsequently established JWT authentication and caller-aware authorization; Example 09 adds SSE without changing those controls.

The repository keeps only agentgateway. Evidence and limitations are recorded in [`docs/GATEWAY_DECISION.md`](../docs/GATEWAY_DECISION.md).

Streaming was outside the original gateway-selection matrix. Example 09 subsequently proved ordered SSE records, safe Letta text projection, task persistence, and disconnect behavior through the same pinned gateway.

## Progression

| # | Example | State | Main concept |
|---|---|---|---|
| 01 | [`agent-discovery`](01-agent-discovery/) | Documented; manually verified | Discover agent identity, invocation URL, and protocol version through Agent Cards. |
| 02 | [`basic-messaging`](02-basic-messaging/) | Documented; manually verified | Use one A2A client to call both the Letta and external implementations through the same protocol. |
| 03 | [`context-continuation`](03-context-continuation/) | Documented; manually verified | Reuse an opaque `contextId` to continue an interaction across tasks. |
| 04 | [`letta-to-external-a2a-agent`](04-letta-to-external-a2a-agent/) | Documented; manually verified | Letta chooses `a2a_invoke`; the controller calls an independent A2A agent and returns its result. |
| 05 | [`external-a2a-agent-to-letta`](05-external-a2a-agent-to-letta/) | Documented; manually verified | An independent A2A agent discovers and delegates work to Letta. |
| 06 | [`static-bearer-auth`](06-static-bearer-auth/) | Historical stage; verified at `a0219be` | Advertise the gateway policy in Agent Cards and demonstrate missing, incorrect, and valid credentials. |
| 07 | [`oauth-client-credentials`](07-oauth-client-credentials/) | Historical stage; verified at `8122018` | Obtain a short-lived OAuth 2.0 access token and use it for agent-to-agent calls. |
| 08 | [`authorization-policy`](08-authorization-policy/) | Historical stage; verified at `7bfd16b` | Permit or deny A2A operations based on authenticated caller identity and scopes. |
| 09 | [`streaming`](09-streaming/) | Documented; protocol and live suites verified | Translate safe Letta App Server WebSocket events into A2A Server-Sent Events. |
| 10 | [`failure-and-cancellation`](10-failure-and-cancellation/) | Documented; manually verified | Observe explicit failure and cancellation, including outer-to-child cancellation propagation. |
| 11 | [`push-notifications`](11-push-notifications/) | Documented; protocol and live suites verified | Register an authenticated webhook, let the initiating request return, and receive asynchronous task updates. |
| 12 | Hermes TUI to Google ADK | Planned; [implementation plan](../docs/EXAMPLE_12_IMPLEMENTATION_PLAN.md) | Use Hermes's built-in A2A tool from an interactive Docker TUI to continue a conversation with a Google ADK agent through agentgateway. |
| 14 | A2A to ACPX Claude | Planned; [implementation plan](../docs/EXAMPLE_14_IMPLEMENTATION_PLAN.md) | Map an A2A context to one persistent ACPX Claude session and return its final assistant text. |

Example 13 is intentionally unassigned. This roadmap does not invent a filler scenario or create an empty placeholder merely to close the numbering gap.

Implementation order is explicit: deliver Example 12 first. Example 14 remains planned until the Hermes TUI → Google ADK walkthrough is complete and verified.

## Scenario details

### 01 — Agent discovery

Fetch both gateway-published Agent Cards without starting a task. Compare their identity, rewritten invocation URL, protocol version, capabilities, skills, and current security declarations.

### 02 — Basic messaging

Use one client flow for both agents:

1. Send a message asynchronously.
2. Receive a task ID.
3. Poll with `GetTask`.
4. Read the completed text artifact.

This is the smallest interoperability proof.

### 03 — Context continuation

Capture the server-generated `contextId`, send a follow-up using that opaque value, and show continuity. Explain that the Letta bridge maps the A2A context to a Letta conversation rather than treating the two IDs as interchangeable.

### 04 — Letta to an external A2A agent

Send a request to Letta that warrants delegation. Letta calls its scoped, controller-owned `a2a_invoke` tool; the controller performs the A2A task lifecycle against the external agent and returns the result to the active Letta turn.

### 05 — External A2A agent to Letta

Give the external reference agent one narrow outbound delegation path. It discovers Letta's Agent Card, sends an asynchronous task through the official A2A client SDK, polls for completion, and returns the Letta artifact. This completes two-way cross-framework interoperability without adding another agent.

### 06 — Static Bearer authentication

At checkpoint `a0219be`, the shared lab key formed a complete protocol example. Both Agent Cards declared HTTP Bearer authentication, and the gateway demonstrated missing, incorrect, and valid credentials. Example 07 intentionally replaced that runtime policy; the Example 06 README explains how to run the frozen stage.

### 07 — OAuth client credentials

At checkpoint `8122018`, the stack uses a small local authorization server. Calling agents exchange client credentials for short-lived access tokens, cache them until near expiry, and send them as HTTP Bearer authentication. Agentgateway validates issuer, audience, signature, time claims, and subject, then requires the Agent Card's declared `a2a.invoke` scope. Browser login and end-user authorization flows remain out of this server-to-server example.

### 08 — Authorization policy

Separate identity from permission. The current stack uses distinct operator, internal-agent, observer, and denied-invoker identities. Valid credentials with different signed roles and scopes prove that one caller may discover or invoke while another receives `403`. Authorization is enforced by agentgateway, never by asking the model to comply.

### 09 — Streaming

Both agents advertise streaming and use A2A `SendStreamingMessage` over Server-Sent Events. The bridge translates only top-level Letta assistant text into ordered artifact updates, while both implementations emit task/status lifecycle events ending at a terminal state. A deterministic reference-agent probe proves that disconnecting the SSE consumer leaves server-side execution intact for later `GetTask` retrieval.

### 10 — Failure and cancellation

Demonstrate deterministic remote failure, direct task cancellation, and cancellation of a Letta task with an active remote child. Show that both tasks remain terminal and that canceled work does not release its conversation lock before the underlying runtime ends or reaches its bounded fallback.

### 11 — Push notifications

Register an authenticated webhook for a long-running task, let the initiating request return, and receive a later task update by HTTP POST without task polling. Verify callback authentication, duplicate-delivery safety, and retrieval of the final task. This stays last because it adds a second inbound security boundary and delivery-reliability concerns.

### 12 — Hermes TUI to Google ADK

Run the official Hermes Agent TUI interactively inside Docker and enable its built-in `a2a_call` tool for CLI sessions. Hermes calls one Google ADK agent through the existing JWT-protected `agentgateway`, then reuses the returned context ID for a second turn. The example keeps Hermes outbound-only, ADK in memory, and both model-backed paths explicitly live. See the [implementation plan](../docs/EXAMPLE_12_IMPLEMENTATION_PLAN.md).

### 14 — A2A to ACPX Claude

Expose one thin A2A adapter that maps a Letta caller's context to a persistent, server-selected ACPX Claude session. The first slice returns only final assistant text and translates basic cancellation and failure; it does not expose arbitrary ACP agents, workspaces, commands, permissions, or rich event streams. See the [implementation plan](../docs/EXAMPLE_14_IMPLEMENTATION_PLAN.md).

## Required README shape

Every implemented example gets `examples/<number>-<name>/README.md` with:

```text
# Example title

## What this teaches
## Message flow
## Run it
## Expected result
## Watch it happen
## What the controller is doing
## Boundaries
```

Each README must contain one small diagram, copyable commands, short expected output, the task/context IDs worth observing, and a filtered log command.

## Delivery workflow

For each roadmap row:

1. Select one example and define its bounded acceptance criteria.
2. Write failing tests first when behavior is new.
3. Implement only what that example requires.
4. Add the example README beside the behavior.
5. Run the focused tests, deterministic protocol matrix, and live integration suite when applicable.
6. Update this roadmap in the same commit.
7. Fast-forward the reviewed slice to `main`.

Create a GitHub issue only when work needs design discussion, spans several sessions, is blocked externally, is suitable for another contributor, or uncovers a bug that should not interrupt the current layer. Do not create one issue per roadmap row by default.

## Deliberate non-goals

- Three-agent orchestration scenarios. Gateways and protocol adapters are infrastructure, not additional logical agents.
- Deployment across multiple physical hosts.
- Binary file transfer. A2A supports file parts, but storage, scanning, limits, and URI lifecycle would distract from this repository's purpose.
- A URL-handoff example. Sending a URL is ordinary message content, not a distinct A2A capability.
- Dynamic registry-based service discovery. Known Agent Card endpoints are sufficient for two fixed agents.
- Kubernetes or production multi-tenant deployment.

These boundaries do not imply that the features are unimportant. They keep this repository focused on a complete, understandable A2A interaction between Letta and another conforming agent.
