#!/usr/bin/env node
// Build first. All packing/installing/testing happens outside the repository.
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function cleanEnvironment(directory, host = process.env) {
  const env = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"])
    if (host[key]) env[key] = host[key];
  return {
    ...env,
    HOME: join(directory, "home"),
    USERPROFILE: join(directory, "home"),
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_CACHE_HOME: join(directory, "cache"),
    XDG_DATA_HOME: join(directory, "data"),
    LETTA_HOME: join(directory, "letta"),
    LETTA_CODE_HOME: join(directory, "letta-code"),
    TMPDIR: join(directory, "tmp"),
    TEMP: join(directory, "tmp"),
    TMP: join(directory, "tmp"),
    npm_config_userconfig: join(directory, "npmrc"),
    npm_config_globalconfig: join(directory, "global-npmrc"),
    npm_config_cache: join(directory, "npm-cache"),
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    CI: "1",
  };
}

export function runBounded(command, args, options = {}) {
  return new Promise((resolveResult, reject) => {
    execFile(
      command,
      args,
      {
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
        killSignal: "SIGKILL",
        ...options,
      },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              `${command} failed${error.killed ? " (timeout)" : ""}: ${stderr || stdout || error.message}`,
            ),
          );
        else resolveResult(stdout);
      },
    );
  });
}

export function validatePack(pack, manifest) {
  if (pack.name !== manifest.name || pack.version !== manifest.version)
    throw new Error("Tarball identity mismatch");
  if (
    pack.filename !== `${manifest.name}-${manifest.version}.tgz` ||
    /[\\/]/.test(pack.filename)
  )
    throw new Error("Unsafe tarball filename");
  const paths = new Set(pack.files.map((file) => file.path));
  for (const path of paths) {
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path
        .split("/")
        .some(
          (part) =>
            part === ".." ||
            part.startsWith(".") ||
            ["node_modules", "tests", "test", "credentials.json"].includes(
              part,
            ),
        )
    )
      throw new Error(`Forbidden packed file: ${path}`);
    if (
      !/^(dist\/|src\/|package\.json$|README\.md$|CHANGELOG\.md$|THIRD_PARTY_NOTICES\.md$|LICENSE$|MOD\.md$)/.test(
        path,
      )
    )
      throw new Error(`Unexpected packed file: ${path}`);
  }
  const required = ["package.json", "README.md", "LICENSE", "CHANGELOG.md"];
  if (manifest.letta?.mods?.length)
    required.push("THIRD_PARTY_NOTICES.md", "MOD.md");
  for (const path of required)
    if (!paths.has(path)) throw new Error(`Missing packed ${path}`);
  if (!manifest.exports || !manifest.exports["."])
    throw new Error("Missing root export");
  for (const [key, entry] of Object.entries(manifest.exports)) {
    for (const condition of ["import", "types"]) {
      const target = entry[condition];
      if (
        typeof target !== "string" ||
        !target.startsWith("./dist/") ||
        target.includes("..") ||
        !paths.has(target.slice(2))
      )
        throw new Error(`Missing or unsafe ${key} ${condition} export`);
    }
  }
  for (const mod of manifest.letta?.mods ?? [])
    if (!paths.has(mod)) throw new Error(`Missing mod: ${mod}`);
  return pack.filename;
}

export async function main() {
  if (
    !/^24\./.test(process.versions.node) ||
    Number(process.versions.node.split(".")[1]) < 19
  )
    throw new Error("Packed gate requires Node >=24.19.0 <25");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const directory = await mkdtemp(join(tmpdir(), "a2a-packed-"));
  const env = cleanEnvironment(directory);
  const command = (bin, args, cwd = directory) =>
    runBounded(bin, args, { cwd, env });
  try {
    for (const path of [
      "home",
      "config",
      "cache",
      "data",
      "letta",
      "letta-code",
      "tmp",
      "packs",
      "consumer",
    ])
      await mkdir(join(directory, path));
    await writeFile(env.npm_config_userconfig, "");
    await writeFile(env.npm_config_globalconfig, "");
    const manifests = [],
      tarballs = [];
    for (const name of ["letta-a2a-client", "letta-a2a-bridge"]) {
      const packageDir = join(root, "packages", name);
      const manifest = JSON.parse(
        await readFile(join(packageDir, "package.json"), "utf8"),
      );
      if (manifest.name !== name)
        throw new Error(`Established package name changed: ${name}`);
      const json = JSON.parse(
        await command("npm", [
          "pack",
          packageDir,
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          join(directory, "packs"),
        ]),
      );
      // npm 11 emits an array; npm 12 emits a name-keyed object.
      const result = Array.isArray(json) ? json : Object.values(json);
      if (result.length !== 1) throw new Error("Expected exactly one tarball");
      tarballs.push(
        join(directory, "packs", validatePack(result[0], manifest)),
      );
      manifests.push(manifest);
    }
    const consumer = join(directory, "consumer");
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await copyFile(
      join(root, "scripts/release/consumer-fixture.mjs"),
      join(consumer, "fixture.mjs"),
    );
    await writeFile(join(consumer, "expected.json"), JSON.stringify(manifests));
    await command(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--omit=optional",
        "--no-audit",
        "--no-fund",
        tarballs[0],
      ],
      consumer,
    );
    const core = JSON.parse(
      await command(process.execPath, ["fixture.mjs", "--core"], consumer),
    );
    await command(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...tarballs,
        "typescript@5.9.2",
        "@types/node@24.3.0",
      ],
      consumer,
    );
    const checks = JSON.parse(
      await command(process.execPath, ["fixture.mjs"], consumer),
    );
    const imports = manifests.flatMap((m) =>
      Object.keys(m.exports).map(
        (key, i) =>
          `import * as ${m.name.endsWith("client") ? "client" : "bridge"}${i} from ${JSON.stringify(m.name + (key === "." ? "" : key.slice(1)))};`,
      ),
    );
    await writeFile(
      join(consumer, "types.mts"),
      imports.join("\n") +
        '\nconst client = client0.createA2AClient({ routes: { local: "http://127.0.0.1:1234" } });\nclient.close();\nconst bridge = bridge0.createBridge({ sharingDomain: "types", publicBaseUrl: "http://127.0.0.1", runner: { async runTurn() { return { text: "ok", state: "completed" }; } } });\nvoid bridge.close();\n',
    );
    // Match the repository's consumer setting. SDK 0.8.3 / letta-code declarations
    // have upstream missing exports and extensionless NodeNext imports; this is
    // consumer API type-checking, not a claim of clean upstream declaration internals.
    await command(
      process.execPath,
      [
        "node_modules/typescript/bin/tsc",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--target",
        "ES2023",
        "types.mts",
      ],
      consumer,
    );
    console.log(
      JSON.stringify({
        ok: true,
        node: process.versions.node,
        packages: manifests.map(({ name, version }) => ({ name, version })),
        core,
        checks,
        declarations: { consumerNodeNext: true, skipLibCheck: true },
        realBackend: false,
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
