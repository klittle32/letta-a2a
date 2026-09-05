import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  InstallerError,
  defaultInstallPath,
  installA2aCli,
  loadLockManifest,
  selectAsset,
} from "../scripts/install-a2acli.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("a2acli lock manifest", () => {
  test("pins the reviewed official release and checksums", () => {
    const lock = loadLockManifest("tools/a2acli.lock.json");

    expect(lock.release).toEqual({
      tag: "a2a-cli-v0.1.11",
      version: "0.1.11",
      sourceCommit: "4fdb6a9e6016978cb35e3f91cc50ffd056ce21b5",
      expectedVersionOutput: "a2acli 0.1.11",
    });
    expect(lock.assets["darwin-arm64"].sha256).toBe(
      "482e020b050a5109aead39236c4cc3bb4d00724dcdda33bda3c3cd77806884ff",
    );
    expect(lock.assets["darwin-arm64"].checksumUrl).toEndWith(
      "a2acli-v0.1.11-aarch64-apple-darwin.tar.gz.sha256",
    );
    expect(lock.assets["linux-x64"].sha256).toBe(
      "3ae98b45cb501f94db7d85cc8826b0e4814d8ccaa8e31c955831d8ae1a2ec661",
    );
  });

  test("selects only the two walkthrough platforms", () => {
    const lock = loadLockManifest("tools/a2acli.lock.json");
    expect(selectAsset(lock, "darwin", "arm64").name).toContain(
      "aarch64-apple-darwin",
    );
    expect(selectAsset(lock, "linux", "x64").name).toContain(
      "x86_64-unknown-linux-gnu",
    );
    expect(() => selectAsset(lock, "darwin", "x64")).toThrow(
      "unsupported platform",
    );
    expect(() => selectAsset(lock, "win32", "x64")).toThrow(
      "unsupported platform",
    );
  });

  test("places the default install outside the current repository", () => {
    const destination = defaultInstallPath({
      homeDirectory: "/Users/example",
      environment: {},
      version: "0.1.11",
    });
    expect(destination).toBe(
      "/Users/example/.cache/letta-a2a/a2acli/0.1.11/a2acli",
    );
    expect(destination.startsWith(process.cwd())).toBe(false);
  });
});

describe("verified installation", () => {
  test("verifies, extracts, versions, and atomically installs an executable", async () => {
    const fixture = makeArchive("a2acli 0.1.11");
    const destination = join(makeTemp(), "install", "a2acli");

    const installed = await installA2aCli({
      lock: fixture.lock,
      platform: "darwin",
      architecture: "arm64",
      destination,
      fetchImpl: async () => response(fixture.archive),
    });

    expect(installed).toBe(destination);
    expect(lstatSync(destination).isFile()).toBe(true);
    expect(lstatSync(destination).mode & 0o777).toBe(0o755);
    expect(
      Bun.spawnSync([destination, "--version"]).stdout.toString().trim(),
    ).toBe("a2acli 0.1.11");
  });

  test("fails closed on a checksum mismatch without installing", async () => {
    const fixture = makeArchive("a2acli 0.1.11");
    fixture.lock.assets["darwin-arm64"].sha256 = "0".repeat(64);
    const destination = join(makeTemp(), "install", "a2acli");

    await expect(
      installA2aCli({
        lock: fixture.lock,
        platform: "darwin",
        architecture: "arm64",
        destination,
        fetchImpl: async () => response(fixture.archive),
      }),
    ).rejects.toThrow("checksum mismatch");
    expect(existsSync(destination)).toBe(false);
  });

  test("rejects missing digests and oversized downloads", async () => {
    const fixture = makeArchive("a2acli 0.1.11");
    fixture.lock.assets["darwin-arm64"].sha256 = "";

    await expect(
      installA2aCli({
        lock: fixture.lock,
        platform: "darwin",
        architecture: "arm64",
        destination: join(makeTemp(), "a2acli"),
        fetchImpl: async () => response(fixture.archive),
      }),
    ).rejects.toThrow("missing digest");

    fixture.lock.assets["darwin-arm64"].sha256 = fixture.sha256;
    await expect(
      installA2aCli({
        lock: fixture.lock,
        platform: "darwin",
        architecture: "arm64",
        destination: join(makeTemp(), "a2acli"),
        maxArchiveBytes: 8,
        fetchImpl: async () => response(fixture.archive),
      }),
    ).rejects.toThrow("archive exceeds");
  });

  test("rejects a mismatched binary version", async () => {
    const fixture = makeArchive("a2acli 9.9.9");

    await expect(
      installA2aCli({
        lock: fixture.lock,
        platform: "darwin",
        architecture: "arm64",
        destination: join(makeTemp(), "a2acli"),
        fetchImpl: async () => response(fixture.archive),
      }),
    ).rejects.toThrow("version mismatch");
  });

  test("rejects a symlinked archive binary and destination", async () => {
    const linked = makeArchive("a2acli 0.1.11", { symlinkBinary: true });
    await expect(
      installA2aCli({
        lock: linked.lock,
        platform: "darwin",
        architecture: "arm64",
        destination: join(makeTemp(), "a2acli"),
        fetchImpl: async () => response(linked.archive),
      }),
    ).rejects.toThrow("regular file");

    const fixture = makeArchive("a2acli 0.1.11");
    const directory = makeTemp();
    const target = join(directory, "target");
    writeFileSync(target, "old");
    const destination = join(directory, "a2acli");
    symlinkSync(target, destination);
    await expect(
      installA2aCli({
        lock: fixture.lock,
        platform: "darwin",
        architecture: "arm64",
        destination,
        fetchImpl: async () => response(fixture.archive),
      }),
    ).rejects.toThrow("destination");
  });

  test("rejects a symlinked destination ancestor", async () => {
    const fixture = makeArchive("a2acli 0.1.11");
    const directory = makeTemp();
    const target = join(directory, "target");
    mkdirSync(target);
    const linkedParent = join(directory, "linked-parent");
    symlinkSync(target, linkedParent, "dir");

    await expect(
      installA2aCli({
        lock: fixture.lock,
        platform: "darwin",
        architecture: "arm64",
        destination: join(linkedParent, "version", "a2acli"),
        fetchImpl: async () => response(fixture.archive),
      }),
    ).rejects.toThrow("ancestor");
    expect(existsSync(join(target, "version", "a2acli"))).toBe(false);
  });

  test("uses a bounded download deadline", async () => {
    const fixture = makeArchive("a2acli 0.1.11");
    await expect(
      installA2aCli({
        lock: fixture.lock,
        platform: "darwin",
        architecture: "arm64",
        destination: join(makeTemp(), "a2acli"),
        downloadTimeoutMs: 5,
        fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
          await Bun.sleep(50);
          if (init?.signal?.aborted) throw init.signal.reason;
          return response(fixture.archive);
        },
      }),
    ).rejects.toBeInstanceOf(InstallerError);
  });
});

function makeArchive(
  versionOutput: string,
  options: { symlinkBinary?: boolean } = {},
) {
  const directory = makeTemp();
  const archiveRoot = "a2acli-v0.1.11-aarch64-apple-darwin";
  const root = join(directory, archiveRoot);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "LICENSE.md"), "license\n");
  writeFileSync(join(root, "README.md"), "readme\n");
  const binary = join(root, "a2acli");
  if (options.symlinkBinary) {
    symlinkSync("README.md", binary);
  } else {
    writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' '${versionOutput}'\n`);
    chmodSync(binary, 0o755);
  }
  const archivePath = join(directory, "fixture.tar.gz");
  const result = Bun.spawnSync([
    "tar",
    "-czf",
    archivePath,
    "-C",
    directory,
    archiveRoot,
  ]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  const archive = readFileSync(archivePath);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  return {
    archive,
    sha256,
    lock: {
      schemaVersion: 1,
      release: {
        tag: "a2a-cli-v0.1.11",
        version: "0.1.11",
        sourceCommit: "4fdb6a9e6016978cb35e3f91cc50ffd056ce21b5",
        expectedVersionOutput: "a2acli 0.1.11",
      },
      assets: {
        "darwin-arm64": {
          name: "fixture.tar.gz",
          url: "https://github.com/a2aproject/a2a-rs/releases/download/test/fixture.tar.gz",
          checksumUrl:
            "https://github.com/a2aproject/a2a-rs/releases/download/test/fixture.tar.gz.sha256",
          sha256,
          archiveRoot,
        },
      },
    },
  };
}

function response(body: Uint8Array): Response {
  return new Response(Buffer.from(body), {
    status: 200,
    headers: { "content-length": String(body.byteLength) },
  });
}

function makeTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), "a2acli-installer-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
