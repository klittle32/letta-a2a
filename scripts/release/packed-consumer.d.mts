import type { ExecFileOptionsWithStringEncoding } from "node:child_process";

export function cleanEnvironment(
  directory: string,
  host?: NodeJS.ProcessEnv,
): Record<string, string>;
export interface PackedManifest {
  name: string;
  version: string;
  exports: Record<string, { import: string; types: string }>;
  letta?: { mods?: string[] };
}
export function validatePack(
  pack: {
    name: string;
    version: string;
    filename: string;
    files: { path: string }[];
  },
  manifest: PackedManifest,
): string;
export function runBounded(
  command: string,
  args: string[],
  options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
): Promise<string>;
export function main(): Promise<void>;
