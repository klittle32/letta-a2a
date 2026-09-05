#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOCK_PATH = resolve(
  SCRIPT_DIRECTORY,
  "../tools/a2acli.lock.json",
);
const DEFAULT_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

export class InstallerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "InstallerError";
  }
}

export function loadLockManifest(path = DEFAULT_LOCK_PATH) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new InstallerError("unable to read the a2acli lock manifest", {
      cause: error,
    });
  }
  validateLock(lock);
  return lock;
}

export function selectAsset(
  lock,
  platform = process.platform,
  architecture = process.arch,
) {
  validateLock(lock);
  const key = `${platform}-${architecture}`;
  const asset = lock.assets[key];
  if (!asset) {
    throw new InstallerError(`unsupported platform: ${key}`);
  }
  if (!/^[a-f0-9]{64}$/.test(asset.sha256 ?? "")) {
    throw new InstallerError(`missing digest for platform: ${key}`);
  }
  return asset;
}

export function defaultInstallPath({
  homeDirectory = homedir(),
  environment = process.env,
  version,
} = {}) {
  if (!version) {
    version = loadLockManifest().release.version;
  }
  const cacheRoot = environment.XDG_CACHE_HOME || join(homeDirectory, ".cache");
  return join(cacheRoot, "letta-a2a", "a2acli", version, "a2acli");
}

export async function installA2aCli({
  lock = loadLockManifest(),
  platform = process.platform,
  architecture = process.arch,
  destination,
  fetchImpl = globalThis.fetch,
  maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES,
  downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
} = {}) {
  const asset = selectAsset(lock, platform, architecture);
  destination ||= defaultInstallPath({ version: lock.release.version });
  if (!isAbsolute(destination)) {
    throw new InstallerError("install destination must be an absolute path");
  }
  destination = resolve(destination);
  assertDestinationAncestrySafe(destination);
  assertDestinationSafe(destination);

  const archive = await downloadArchive(asset.url, {
    fetchImpl,
    maxBytes: maxArchiveBytes,
    timeoutMs: downloadTimeoutMs,
  });
  const actualDigest = createHash("sha256").update(archive).digest("hex");
  if (actualDigest !== asset.sha256) {
    throw new InstallerError("a2acli archive checksum mismatch");
  }

  const destinationDirectory = dirname(destination);
  mkdirSync(destinationDirectory, { recursive: true, mode: 0o755 });
  assertDestinationAncestrySafe(destination);
  const destinationDescriptor = openSync(
    destinationDirectory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const destinationIdentity = fstatSync(destinationDescriptor);
  const stage = mkdtempSync(join(destinationDirectory, ".a2acli-install-"));
  const archivePath = join(stage, asset.name);
  const stagedBinary = join(stage, "payload", "a2acli");

  try {
    writeFileSync(archivePath, archive, { mode: 0o600, flag: "wx" });
    const entries = listArchive(archivePath);
    validateArchiveEntries(entries, asset.archiveRoot);
    mkdirSync(dirname(stagedBinary), { mode: 0o700 });
    runTar([
      "-xzf",
      archivePath,
      "-C",
      dirname(stagedBinary),
      "--strip-components=1",
      `${asset.archiveRoot}/a2acli`,
    ]);

    const metadata = lstatSync(stagedBinary);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new InstallerError("archive binary is not a regular file");
    }
    chmodSync(stagedBinary, 0o755);
    verifyVersion(stagedBinary, lock.release.expectedVersionOutput);

    assertDestinationAncestrySafe(destination);
    const currentDirectory = lstatSync(destinationDirectory);
    if (
      !currentDirectory.isDirectory() ||
      currentDirectory.isSymbolicLink() ||
      currentDirectory.dev !== destinationIdentity.dev ||
      currentDirectory.ino !== destinationIdentity.ino
    ) {
      throw new InstallerError("install destination ancestor changed");
    }
    assertDestinationSafe(destination);
    const descriptor = openSync(stagedBinary, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(stagedBinary, destination);
    chmodSync(destination, 0o755);
    return destination;
  } catch (error) {
    if (error instanceof InstallerError) throw error;
    throw new InstallerError("a2acli installation failed", { cause: error });
  } finally {
    closeSync(destinationDescriptor);
    rmSync(stage, { recursive: true, force: true });
  }
}

async function downloadArchive(url, { fetchImpl, maxBytes, timeoutMs }) {
  if (typeof fetchImpl !== "function") {
    throw new InstallerError("fetch is unavailable");
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("download deadline exceeded")),
    timeoutMs,
  );

  try {
    let current = new URL(url);
    let response;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      response = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "letta-a2a-example-13-installer" },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects === MAX_REDIRECTS) {
        throw new InstallerError("a2acli download exceeded the redirect limit");
      }
      const location = response.headers.get("location");
      if (!location)
        throw new InstallerError("a2acli download redirect had no location");
      current = new URL(location, current);
      if (current.protocol !== "https:") {
        throw new InstallerError(
          "a2acli download refused a non-HTTPS redirect",
        );
      }
    }
    if (!response?.ok) {
      throw new InstallerError(
        `a2acli download failed with HTTP ${response?.status ?? "error"}`,
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new InstallerError("a2acli archive exceeds the download limit");
    }
    if (!response.body)
      throw new InstallerError("a2acli download returned no body");

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new InstallerError("a2acli archive exceeds the download limit");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof InstallerError) throw error;
    throw new InstallerError("a2acli download failed", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

function listArchive(archivePath) {
  const result = runTar(["-tzf", archivePath]);
  return result.stdout.toString("utf8").split("\n").filter(Boolean);
}

function validateArchiveEntries(entries, archiveRoot) {
  const expected = new Set([
    `${archiveRoot}/`,
    `${archiveRoot}/LICENSE.md`,
    `${archiveRoot}/README.md`,
    `${archiveRoot}/a2acli`,
  ]);
  if (
    entries.length !== expected.size ||
    new Set(entries).size !== entries.length ||
    entries.some((entry) => !expected.has(entry))
  ) {
    throw new InstallerError("a2acli archive contains unexpected entries");
  }
}

function runTar(arguments_) {
  const result = spawnSync("tar", arguments_, {
    shell: false,
    encoding: null,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new InstallerError("unable to inspect or extract the a2acli archive");
  }
  return result;
}

function verifyVersion(binary, expected) {
  const result = spawnSync(binary, ["--version"], {
    shell: false,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    env: minimalEnvironment(),
  });
  if (
    result.error ||
    result.status !== 0 ||
    result.stdout.trim() !== expected
  ) {
    throw new InstallerError("a2acli binary version mismatch");
  }
}

function assertDestinationSafe(destination) {
  if (!existsSync(destination)) return;
  const metadata = lstatSync(destination);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new InstallerError(
      "install destination must be a regular file or absent",
    );
  }
}

function assertDestinationAncestrySafe(destination) {
  const directory = dirname(resolve(destination));
  const root = parse(directory).root;
  let current = root;
  for (const component of relative(root, directory)
    .split(/[\\/]+/)
    .filter(Boolean)) {
    current = join(current, component);
    if (!existsSync(current)) break;
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink()) {
      // macOS exposes root-owned compatibility aliases such as /var -> /private/var.
      if (metadata.uid === 0) continue;
      throw new InstallerError("install destination has a symlinked ancestor");
    }
    if (!metadata.isDirectory()) {
      throw new InstallerError(
        "install destination has a non-directory ancestor",
      );
    }
  }
}

function validateLock(lock) {
  if (
    lock?.schemaVersion !== 1 ||
    typeof lock.release?.version !== "string" ||
    typeof lock.release?.tag !== "string" ||
    !/^[a-f0-9]{40}$/.test(lock.release?.sourceCommit ?? "") ||
    typeof lock.release?.expectedVersionOutput !== "string" ||
    !lock.assets ||
    typeof lock.assets !== "object"
  ) {
    throw new InstallerError("invalid a2acli lock manifest");
  }
  for (const asset of Object.values(lock.assets)) {
    if (
      typeof asset?.name !== "string" ||
      typeof asset?.url !== "string" ||
      typeof asset?.checksumUrl !== "string" ||
      typeof asset?.archiveRoot !== "string"
    ) {
      throw new InstallerError("invalid a2acli asset lock entry");
    }
    for (const value of [asset.url, asset.checksumUrl]) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "github.com") {
        throw new InstallerError(
          "a2acli asset URL is not an approved HTTPS origin",
        );
      }
    }
  }
}

function minimalEnvironment() {
  const environment = {};
  for (const key of ["HOME", "PATH", "TMPDIR", "SystemRoot", "WINDIR"]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

function parseMainArguments(arguments_) {
  if (arguments_.length === 0) return {};
  if (arguments_.length === 2 && arguments_[0] === "--destination") {
    return { destination: resolve(arguments_[1]) };
  }
  throw new InstallerError(
    "usage: install-a2acli.mjs [--destination <absolute-path>]",
  );
}

async function main() {
  try {
    const options = parseMainArguments(process.argv.slice(2));
    const installed = await installA2aCli(options);
    process.stdout.write(`${installed}\n`);
  } catch (error) {
    const message =
      error instanceof InstallerError
        ? error.message
        : "a2acli installation failed";
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
