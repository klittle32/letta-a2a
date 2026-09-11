import { describe, expect, test } from "bun:test";

// Dynamic import also verifies that loading the helper does not run a build.
const helperPath = "../scripts/release/check-bundle.mjs";
const { assertBundleBytes, assertBunVersion } = await import(helperPath);

const bytes = (text: string) => Buffer.from(text);

describe("release bundle byte comparisons", () => {
  test("accepts two builds identical to the committed bundle", () => {
    expect(() =>
      assertBundleBytes(bytes("bundle"), bytes("bundle"), bytes("bundle")),
    ).not.toThrow();
  });

  test("rejects a stale committed bundle even when both builds agree", () => {
    expect(() =>
      assertBundleBytes(bytes("old"), bytes("new"), bytes("new")),
    ).toThrow("stale");
  });

  test("rejects a second build differing from the first and committed bundle", () => {
    expect(() =>
      assertBundleBytes(bytes("same"), bytes("same"), bytes("different")),
    ).toThrow("not reproducible");
  });

  test("rejects a first build differing from the second and committed bundle", () => {
    expect(() =>
      assertBundleBytes(bytes("same"), bytes("different"), bytes("same")),
    ).toThrow("not reproducible");
  });

  test("compares bytes rather than decoded text", () => {
    expect(() =>
      assertBundleBytes(
        Buffer.from([0xff]),
        Buffer.from([0xfe]),
        Buffer.from([0xfe]),
      ),
    ).toThrow("stale");
  });

  test("accepts only the pinned Bun version", () => {
    expect(() => assertBunVersion("1.4.2\n")).not.toThrow();
    expect(() => assertBunVersion("1.4.1")).toThrow("Bun 1.4.2");
    expect(() => assertBunVersion("1.4.2-canary")).toThrow("Bun 1.4.2");
  });
});
