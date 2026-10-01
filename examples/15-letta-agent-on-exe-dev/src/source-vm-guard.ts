import type { RequestHandler } from "express";

/**
 * Rejects A2A calls that did not arrive from an allowed exe.dev VM.
 *
 * exe.dev's VM-to-VM integration sets X-Exedev-Source-Vm and strips it on every
 * other path, so a caller cannot forge it. Discovery stays open so clients can
 * read the card through the gateway.
 */
export function sourceVmGuard(allowed: Set<string>): RequestHandler {
  return (req, res, next) => {
    if (allowed.size === 0 || req.path.startsWith("/.well-known/")) return next();
    const sourceVm = req.get("x-exedev-source-vm") ?? "";
    if (allowed.has(sourceVm)) return next();
    console.warn(
      `rejected call from source_vm=${JSON.stringify(sourceVm)} path=${req.path}`,
    );
    res
      .status(403)
      .json({ error: "This agent only accepts calls through its gateway." });
  };
}
