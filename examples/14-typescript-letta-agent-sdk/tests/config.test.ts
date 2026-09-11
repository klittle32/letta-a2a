import { expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";

test("SDK client tools are the default; routes remain explicit", () => {
  expect(loadConfig({})).toMatchObject({
    clientAdapter: "sdk",
    outboundRoutes: undefined,
  });
  expect(
    loadConfig({ A2A_REMOTE_ROUTES: '{"peer":"http://127.0.0.1:41242"}' })
      .outboundRoutes,
  ).toEqual({ peer: "http://127.0.0.1:41242" });
});

test("invalid or ambiguous client adapter configuration fails before setup", () => {
  expect(() => loadConfig({ A2A_CLIENT_ADAPTER: "unknown" })).toThrow();
  expect(() => loadConfig({ A2A_REMOTE_ROUTES: "[]" })).toThrow();
  expect(() => loadConfig({ A2A_REMOTE_ROUTES: '{"peer":42}' })).toThrow();
  expect(() =>
    loadConfig({ A2A_CLIENT_ADAPTER: "mod", A2A_REMOTE_ROUTES: "{}" }),
  ).toThrow();
});
