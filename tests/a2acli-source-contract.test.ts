import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installA2aCli } from "../scripts/install-a2acli.mjs";

const describeRealBinary =
  process.env.A2ACLI_REAL_BINARY_TEST === "1" ? describe : describe.skip;

describeRealBinary("a2acli v0.1.11 real-binary source contract", () => {
  const token = "fixture-bearer-token";
  let root: string;
  let binary: string;
  let baseUrl = "";
  let server: ReturnType<typeof createServer>;
  const observations: Array<{
    path: string;
    authorization?: string;
    body?: any;
  }> = [];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "a2acli-source-contract-"));
    binary = join(root, "a2acli");
    await installA2aCli({ destination: binary });
    chmodSync(binary, 0o700);
    server = createServer(handler);
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolvePromise());
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("fixture did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolvePromise) =>
      server.close(() => resolvePromise()),
    );
    rmSync(root, { recursive: true, force: true });
  });

  test("help exposes the reviewed commands and flags", async () => {
    const global = await run(["--help"]);
    const send = await run(["send", "--help"]);
    expect(global.status).toBe(0);
    expect(global.stdout).toContain("--base-url");
    expect(global.stdout).toContain("--compact");
    for (const command of ["card", "send", "get-task", "cancel-task"]) {
      expect(global.stdout).toMatch(new RegExp(`\\b${command}\\b`));
    }
    expect(send.status).toBe(0);
    expect(send.stdout).toContain("--context-id");
    expect(send.stdout).toContain("--return-immediately");
  });

  test("fetches an authenticated card and emits compact JSON", async () => {
    observations.length = 0;
    const result = await cli(["card"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toContain("\n");
    expect(JSON.parse(result.stdout)).toMatchObject({
      name: "fixture",
      supportedInterfaces: card().supportedInterfaces,
    });
    expect(observations).toEqual([
      {
        path: "/.well-known/agent-card.json",
        authorization: `Bearer ${token}`,
      },
    ]);
  });

  test("sends directly with exact context and returnImmediately, including leading-hyphen text", async () => {
    observations.length = 0;
    const result = await cli([
      "send",
      "--return-immediately",
      "--context-id",
      "Context/Exact",
      "--",
      "--safe-text",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      message: { contextId: "Context/Exact", parts: [{ text: "direct" }] },
    });
    const rpc = observations.at(-1)!;
    expect(rpc.authorization).toBe(`Bearer ${token}`);
    expect(rpc.body.method).toBe("SendMessage");
    expect(rpc.body.params.configuration.returnImmediately).toBe(true);
    expect(rpc.body.params.message.contextId).toBe("Context/Exact");
    expect(rpc.body.params.message.parts[0].text).toBe("--safe-text");
  });

  test("supports task send, get-task, and cancel-task", async () => {
    observations.length = 0;
    expect(JSON.parse((await cli(["send", "queued"])).stdout)).toMatchObject({
      task: { id: "task-1" },
    });
    expect(
      JSON.parse((await cli(["get-task", "task-1"])).stdout),
    ).toMatchObject({ id: "task-1", status: { state: "TASK_STATE_WORKING" } });
    expect(
      JSON.parse((await cli(["cancel-task", "task-1"])).stdout),
    ).toMatchObject({ id: "task-1", status: { state: "TASK_STATE_CANCELED" } });
    expect(
      observations.filter((item) => item.body).map((item) => item.body.method),
    ).toEqual(["SendMessage", "GetTask", "CancelTask"]);
    expect(
      observations.every((item) => item.authorization === `Bearer ${token}`),
    ).toBe(true);
  });

  test("returns nonzero for a malformed server response", async () => {
    const result = await cli(["send", "malformed"]);
    expect(result.status).not.toBe(0);
  });

  function run(args: string[], environment: Record<string, string> = {}) {
    return new Promise<{ status: number; stdout: string; stderr: string }>(
      (resolvePromise) => {
        const child = spawn(binary, args, {
          env: { ...process.env, ...environment },
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
        child.on("close", (status) =>
          resolvePromise({
            status: status ?? 1,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          }),
        );
      },
    );
  }

  function cli(command: string[]) {
    return run(
      ["--base-url", baseUrl, "--binding", "jsonrpc", "--compact", ...command],
      { A2A_BEARER_TOKEN: token },
    );
  }

  function card() {
    return {
      name: "fixture",
      description: "local source-contract fixture",
      version: "1.0.0",
      protocolVersion: "1.0",
      capabilities: {},
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [
        { id: "text", name: "text", description: "text", tags: ["text"] },
      ],
      supportedInterfaces: [
        { url: baseUrl, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      ],
    };
  }

  async function handler(request: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : undefined;
    observations.push({
      path: request.url ?? "",
      authorization: request.headers.authorization,
      ...(body ? { body } : {}),
    });
    if (request.headers.authorization !== `Bearer ${token}`)
      return json(response, 401, { error: "unauthorized" });
    if (request.url === "/.well-known/agent-card.json")
      return json(response, 200, card());
    if (
      body?.method === "SendMessage" &&
      body.params?.message?.parts?.[0]?.text === "malformed"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end("not-json");
    }
    let result: any;
    if (body?.method === "SendMessage") {
      const text = body.params.message.parts[0].text;
      result =
        text === "queued"
          ? {
              kind: "task",
              id: "task-1",
              contextId: "task-context",
              status: {
                state: "TASK_STATE_SUBMITTED",
                timestamp: new Date().toISOString(),
              },
            }
          : {
              kind: "message",
              messageId: "message-1",
              ...(body.params.message.contextId
                ? { contextId: body.params.message.contextId }
                : {}),
              role: "ROLE_AGENT",
              parts: [{ text: "direct" }],
            };
    } else if (body?.method === "GetTask") {
      result = {
        kind: "task",
        id: body.params.id,
        contextId: "task-context",
        status: {
          state: "TASK_STATE_WORKING",
          timestamp: new Date().toISOString(),
        },
      };
    } else if (body?.method === "CancelTask") {
      result = {
        kind: "task",
        id: body.params.id,
        contextId: "task-context",
        status: {
          state: "TASK_STATE_CANCELED",
          timestamp: new Date().toISOString(),
        },
      };
    } else return json(response, 400, { error: "unknown" });
    const wire = (({ kind, ...value }) => value)(result);
    return json(response, 200, {
      jsonrpc: "2.0",
      id: body.id,
      result:
        body.method === "SendMessage"
          ? result.kind === "message"
            ? { message: wire }
            : { task: wire }
          : wire,
    });
  }

  function json(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
});
