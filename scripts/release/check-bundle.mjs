import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const client = join(root, "packages/letta-a2a-client");
const bundle = join(client, "dist/a2a-client.mjs");

export function assertBunVersion(version) {
  if (version.trim() !== "1.4.2") {
    throw new Error(
      `Bundle verification requires Bun 1.4.2; found ${version.trim()}`,
    );
  }
}

export function assertBundleBytes(committed, first, second) {
  if (!first.equals(second)) {
    throw new Error(
      "Client mod bundle is not reproducible: the two temporary builds differ.",
    );
  }
  if (!committed.equals(first) || !committed.equals(second)) {
    throw new Error(
      "Committed client mod bundle is stale. Review the drift, then intentionally regenerate with Bun 1.4.2: " +
        "(cd packages/letta-a2a-client && bun run build). Review and commit dist/a2a-client.mjs, then rerun this check. " +
        "This check has not overwritten the committed bundle.",
    );
  }
}

export async function checkBundle() {
  assertBunVersion(
    execFileSync("bun", ["--version"], {
      encoding: "utf8",
      timeout: 60_000,
      killSignal: "SIGKILL",
    }),
  );
  // Snapshot before any builds; never write to the tracked output path.
  const committed = await readFile(bundle);
  const temporary = await mkdtemp(join(tmpdir(), "letta-a2a-bundle-"));
  try {
    const outputs = [
      join(temporary, "first.mjs"),
      join(temporary, "second.mjs"),
    ];
    for (const output of outputs) {
      execFileSync(
        "bun",
        [
          "build",
          "mods/a2a-client.ts",
          "--target=node",
          "--format=esm",
          `--outfile=${output}`,
        ],
        { cwd: client, stdio: "pipe", timeout: 60_000, killSignal: "SIGKILL" },
      );
    }
    const [first, second] = await Promise.all(
      outputs.map((output) => readFile(output)),
    );
    assertBundleBytes(committed, first, second);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  checkBundle().then(
    () =>
      console.log(
        "Client mod bundle matches two reproducible Bun 1.4.2 builds.",
      ),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
