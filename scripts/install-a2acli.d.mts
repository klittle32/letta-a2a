export interface A2aCliAsset {
  name: string;
  url: string;
  checksumUrl: string;
  sha256: string;
  archiveRoot: string;
}

export interface A2aCliLock {
  schemaVersion: number;
  release: {
    tag: string;
    version: string;
    sourceCommit: string;
    expectedVersionOutput: string;
  };
  assets: Record<string, A2aCliAsset>;
}

export class InstallerError extends Error {}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function loadLockManifest(path?: string): A2aCliLock;
export function selectAsset(
  lock: A2aCliLock,
  platform?: string,
  architecture?: string,
): A2aCliAsset;
export function defaultInstallPath(options?: {
  homeDirectory?: string;
  environment?: Record<string, string | undefined>;
  version?: string;
}): string;
export function installA2aCli(options?: {
  lock?: A2aCliLock;
  platform?: string;
  architecture?: string;
  destination?: string;
  fetchImpl?: FetchLike;
  maxArchiveBytes?: number;
  downloadTimeoutMs?: number;
}): Promise<string>;
