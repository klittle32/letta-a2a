import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const examplePath = "examples/13-a2a-cli-skill/README.md";
const skillPath = "skills/a2a-cli/SKILL.md";

describe("Example 13 canonical A2A CLI", () => {
  test("uses the released official CLI instead of the superseded Rust workflow", () => {
    const example = readFileSync(examplePath, "utf8");

    expect(example).toContain("https://github.com/a2aproject/a2a-cli");
    expect(example).toContain("v0.3.0");
    expect(example).toContain("WinGet catalog still lists v0.2.0");
    expect(example).toContain("does not publish a Scoop manifest");
    expect(example).toContain("brew tap a2aproject/a2a-cli");
    expect(example).toContain("brew install a2a");
    expect(example).toContain("a2a version");
    expect(example).not.toContain("a2aproject/a2a-rs");
  });

  test("documents the verified direct-endpoint task and continuation commands", () => {
    const example = readFileSync(examplePath, "utf8");

    expect(example).toContain(
      "A2A_ENDPOINT=http://127.0.0.1:4000/a2a/google-adk",
    );
    expect(example).toContain('-e "$A2A_ENDPOINT" --transport jsonrpc');
    expect(example).toContain("a2a send");
    expect(example).toContain("--async");
    expect(example).toContain("a2a task get");
    expect(example).toContain("a2a task list");
    expect(example).toContain("--wait");
    expect(example).toContain("--task-id");
    expect(example).toContain("--context-id");
    expect(example).not.toContain("get-task");
    expect(example).not.toContain("cancel-task");
    expect(example).not.toContain("--return-immediately");
  });

  test("documents the v0.3 skill, file-part, config, and plugin additions", () => {
    const example = readFileSync(examplePath, "utf8");

    expect(example).toContain("a2a skill");
    expect(example).toContain("--save-fileparts");
    expect(example).toContain("~/.config/a2a-cli/config.yaml");
    expect(example).toContain("a2a plugin set-enabled true");
    expect(example).toContain("disabled by default");
  });

  test("records the released CLI Agent Card limitation instead of weakening the card", () => {
    const example = readFileSync(examplePath, "utf8");

    expect(example).toContain("A2ACLI_ERR_CARD_INVALID");
    expect(example).toContain("strict ProtoJSON");
    expect(example).toContain("The Agent Card remains unchanged");
  });

  test("ships the official released skill contract under its canonical name", () => {
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync("skills/a2a-cli/LICENSE")).toBe(true);
    expect(existsSync("skills/using-a2a-cli/SKILL.md")).toBe(false);

    const skill = readFileSync(skillPath, "utf8");
    const license = readFileSync("skills/a2a-cli/LICENSE", "utf8");
    expect(skill).toContain("name: a2a-cli");
    expect(skill).toContain("github.com/a2aproject/a2a-cli");
    expect(skill).toContain('version: "2026.09.22"');
    expect(skill).toContain("run `a2a skill`");
    expect(skill).toContain("--save-fileparts <dir>");
    expect(skill).toContain("~/.config/a2a-cli/config.yaml");
    expect(skill).toContain("a2a plugin");
    expect(skill).toContain("a2a task subscribe");
    expect(skill).toContain("a2a task cancel");
    expect(skill).toContain("Never commit a secret");
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");
  });

  test("keeps repository navigation aligned with the canonical CLI", () => {
    const root = readFileSync("README.md", "utf8");
    const examples = readFileSync("examples/README.md", "utf8");
    const conclusions = readFileSync("docs/CONCLUSIONS.md", "utf8");
    const combined = `${root}\n${examples}\n${conclusions}`;

    expect(combined).toContain("official `a2a` CLI");
    expect(root).toContain("2026-09-25-example-13-cli-v0.3.0.md");
    expect(examples).toContain("v0.3.0 direct-endpoint path verified");
    expect(combined).not.toMatch(/official `a2acli`/);
    expect(combined).not.toContain("using-a2a-cli skill");
  });
});
