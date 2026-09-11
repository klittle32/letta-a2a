import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cleanEnvironment,
  validatePack,
  runBounded,
} from "../scripts/release/packed-consumer.mjs";

const manifest = {
  name: "letta-a2a-client",
  version: "0.1.0-alpha.7",
  exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
};
const pack = () => ({
  name: manifest.name,
  version: manifest.version,
  filename: `${manifest.name}-${manifest.version}.tgz`,
  files: [
    "package.json",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "dist/index.js",
    "dist/index.d.ts",
  ].map((path) => ({ path })),
});
describe("packed consumer gate helpers (no npm installs)", () => {
  test("accepts dynamic prerelease versions", () =>
    expect(validatePack(pack(), manifest)).toBe(pack().filename));
  test("rejects wrong package identity", () =>
    expect(() =>
      validatePack({ ...pack(), name: "wrong" }, manifest),
    ).toThrow());
  test("rejects missing declarations", () =>
    expect(() =>
      validatePack(
        {
          ...pack(),
          files: pack().files.filter((f) => !f.path.endsWith(".d.ts")),
        },
        manifest,
      ),
    ).toThrow());
  test("rejects secrets and repository payloads", () => {
    for (const path of [
      ".env",
      "dist/.env.local",
      "node_modules/a/index.js",
      "tests/a.ts",
      "dist/credentials.json",
      "../escape",
    ]) {
      expect(() =>
        validatePack(
          { ...pack(), files: [...pack().files, { path }] },
          manifest,
        ),
      ).toThrow();
    }
  });
  test("rejects escaping tarball filenames and export targets", () => {
    expect(() =>
      validatePack({ ...pack(), filename: "../escape.tgz" }, manifest),
    ).toThrow();
    expect(() =>
      validatePack(pack(), {
        ...manifest,
        exports: {
          ".": { import: "../outside.js", types: "./dist/index.d.ts" },
        },
      }),
    ).toThrow();
  });
  test("requires license and readme", () => {
    for (const path of ["LICENSE", "README.md", "CHANGELOG.md"])
      expect(() =>
        validatePack(
          { ...pack(), files: pack().files.filter((f) => f.path !== path) },
          manifest,
        ),
      ).toThrow();
  });
  test("requires attribution and instructions for the bundled mod", () => {
    expect(() =>
      validatePack(pack(), { ...manifest, letta: { mods: ["dist/index.js"] } }),
    ).toThrow();
  });
  test("environment is an allowlist, not a credential blacklist", () => {
    const env = cleanEnvironment("/isolated", {
      PATH: "/bin",
      OPENAI_API_KEY: "secret",
      LETTA_API_KEY: "secret",
      NODE_OPTIONS: "--require=evil",
      npm_config_userconfig: "/host",
      HOME: "/host",
    });
    expect(env.PATH).toBe("/bin");
    expect(env.HOME).toBe("/isolated/home");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.LETTA_API_KEY).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.npm_config_userconfig).toBe("/isolated/npmrc");
  });
  for (const [name, source] of [
    ["network", "fetch('http://127.0.0.1:1');"],
    [
      "subprocess",
      "import { spawn } from 'node:child_process'; spawn('must-not-run');",
    ],
    ["swallowed network", "try { fetch('http://127.0.0.1:1'); } catch {}"],
  ])
    test(`consumer fixture rejects ${name} import side effects without npm`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "packed-rejection-"));
      try {
        const env = cleanEnvironment(directory);
        for (const key of [
          "HOME",
          "XDG_CONFIG_HOME",
          "XDG_CACHE_HOME",
          "XDG_DATA_HOME",
          "LETTA_HOME",
          "LETTA_CODE_HOME",
        ])
          await mkdir(env[key], { recursive: true });
        const module = join(directory, "node_modules/letta-a2a-client");
        await mkdir(module, { recursive: true });
        await writeFile(
          join(module, "package.json"),
          JSON.stringify({ type: "module", exports: "./index.js" }),
        );
        await writeFile(
          join(module, "index.js"),
          `${source}\nexport function createA2AClient() { return { close() {} }; }`,
        );
        await writeFile(join(directory, "expected.json"), "[]");
        await copyFile(
          new URL("../scripts/release/consumer-fixture.mjs", import.meta.url),
          join(directory, "fixture.mjs"),
        );
        await expect(
          runBounded("node", ["fixture.mjs", "--core"], {
            cwd: directory,
            env,
            timeout: 5000,
          }),
        ).rejects.toThrow(
          name === "swallowed network"
            ? "AssertionError"
            : "Unexpected import side effect",
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  test("bounded child rejects failures and timeout", async () => {
    await expect(
      runBounded(process.execPath, ["-e", "process.exit(9)"]),
    ).rejects.toThrow();
    await expect(
      runBounded(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        timeout: 50,
      }),
    ).rejects.toThrow();
  });
  for (const phase of ["import", "activation"])
    test(`consumer fixture rejects standalone mod ${phase} side effects`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "packed-mod-rejection-"));
      try {
        const env = cleanEnvironment(directory);
        for (const key of [
          "HOME",
          "XDG_CONFIG_HOME",
          "XDG_CACHE_HOME",
          "XDG_DATA_HOME",
          "LETTA_HOME",
          "LETTA_CODE_HOME",
        ])
          await mkdir(env[key], { recursive: true });
        const module = join(directory, "node_modules/letta-a2a-client");
        await mkdir(join(module, "dist"), { recursive: true });
        const metadata = {
          ...manifest,
          type: "module",
          letta: { mods: ["dist/mod.mjs"] },
        };
        await writeFile(join(module, "package.json"), JSON.stringify(metadata));
        await writeFile(
          join(module, "dist/index.js"),
          "export function createA2AClient() { return { close() {} }; }",
        );
        await writeFile(
          join(module, "dist/index.d.ts"),
          "export declare const fixture: string;",
        );
        await writeFile(
          join(module, "dist/mod.mjs"),
          phase === "import"
            ? "fetch('http://127.0.0.1:1'); export default function() {}"
            : "export default function() { fetch('http://127.0.0.1:1'); }",
        );
        await writeFile(
          join(directory, "expected.json"),
          JSON.stringify([metadata]),
        );
        await copyFile(
          new URL("../scripts/release/consumer-fixture.mjs", import.meta.url),
          join(directory, "fixture.mjs"),
        );
        await expect(
          runBounded("node", ["fixture.mjs"], {
            cwd: directory,
            env,
            timeout: 5000,
          }),
        ).rejects.toThrow("Unexpected import side effect");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
});
