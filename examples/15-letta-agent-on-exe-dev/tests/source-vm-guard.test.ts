import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Server } from "node:http";
import express from "express";
import { sourceVmGuard } from "../src/source-vm-guard.js";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(sourceVmGuard(new Set(["gateway-vm"])));
  app.use((_req, res) => {
    res.json({ ok: true });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

test("discovery stays open without a source VM", async () => {
  const response = await fetch(`${base}/.well-known/agent-card.json`);
  expect(response.status).toBe(200);
});

test("A2A calls need an allowed source VM", async () => {
  expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(403);
  const other = await fetch(`${base}/`, {
    method: "POST",
    headers: { "x-exedev-source-vm": "some-other-vm" },
  });
  expect(other.status).toBe(403);
  const allowed = await fetch(`${base}/`, {
    method: "POST",
    headers: { "x-exedev-source-vm": "gateway-vm" },
  });
  expect(allowed.status).toBe(200);
});
