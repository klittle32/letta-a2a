import { expect, test } from "bun:test";
import { delegationPolicy } from "../src/delegation.js";

test("top-level explicit delegation increments a host-bound hop", () => {
  expect(
    delegationPolicy({
      text: "Use a2a_invoke",
      returnImmediately: true,
      delegatedCaller: false,
    }),
  ).toEqual({
    hop: 0,
    allowDelegation: true,
    outboundHeaders: { "x-letta-a2a-hop": "1" },
  });
  expect(
    delegationPolicy({
      text: "hello",
      returnImmediately: true,
      delegatedCaller: false,
    }).allowDelegation,
  ).toBe(false);
});

test("nested callers cannot reset or exceed hop policy", () => {
  expect(
    delegationPolicy({
      text: "Use a2a_invoke",
      returnImmediately: true,
      delegatedCaller: true,
      hopHeader: "1",
    }).allowDelegation,
  ).toBe(false);
  for (const hopHeader of [undefined, "0", "-1", "01", "1.5", "2", "1, 1"]) {
    expect(() =>
      delegationPolicy({
        text: "hello",
        returnImmediately: true,
        delegatedCaller: true,
        hopHeader,
      }),
    ).toThrow();
  }
  expect(() =>
    delegationPolicy({
      text: "hello",
      returnImmediately: true,
      delegatedCaller: false,
      hopHeader: "1",
    }),
  ).toThrow();
});

test("delegation requires async submission, not a blocking nested turn", () => {
  expect(() =>
    delegationPolicy({
      text: "a2a_invoke",
      returnImmediately: false,
      delegatedCaller: false,
    }),
  ).toThrow("returnImmediately");
});
