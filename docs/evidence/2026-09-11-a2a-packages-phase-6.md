# Phase 6 — public-release preparation

2026-09-11 checkpoint. **No publication or production deployment.**

Phase 5 was committed as `04a2a37b5d3a9117ed630f8458320db49b0ab529`, fast-forwarded to `main`, pushed, and its worktree/branch removed. Phase 6 is uncommitted in `.letta/worktrees/a2a-phase-6`, branch `letta/a2a-phase-6-da6da296`.

## Prepared artifacts

Kyle explicitly selected **MIT**. Both established unscoped package names are candidates at `0.1.0-alpha.1`, with repository metadata, licenses, changelogs, pinned Bun/Node support declarations, and publication disabled by `private: true` plus `prepublishOnly`. The npm registry returned 404 for both names on September 11; this is not ownership/reservation.

The client distributes the bundled A2A JS SDK 1.1.0 Apache-2.0 license/attribution separately from this project's MIT terms. The bridge moves `@types/express` into production dependencies because its published Router declaration exposes those types. Only that dependency's metadata changed in package/root/example lockfiles; no upstream versions were upgraded.

No production TypeScript or committed mod bundle changed. New release helpers, tests, and workflow are intentionally small, provider-free gates; they do not introduce a release service or automatic publishing machinery. [Release/support policy](../RELEASING.md) owns the operating commands and limits.

## Executed checks

| Check | Result |
|---|---|
| Final macOS Bun suite | **348 tests passed**, 1,804 assertions, 48 files |
| Linux arm64 Bun suite | **348 tests passed**, 1,804 assertions, 48 files |
| Package/root/example TypeScript checks and builds | Passed |
| Pinned two-build byte comparison | Passed on macOS and Linux; tracked bundle remained unchanged |
| Clean npm tarball consumers | Passed on macOS and Linux under ordinary Node 24.19.0 |
| Independent strict review | Reported mod coverage and dependency-masking findings fixed; final focused review found no remaining blocker |
| Frozen locks and whitespace | Passed |

macOS runtime: **26.6.2 arm64**, Node **24.19.0**, Bun **1.4.2**. Linux runtime: Debian Bookworm **arm64**, Node **24.19.0**, Bun **1.4.2**, kernel `7.0.12-linuxkit`. The successful Linux run used a bounded 4 GiB tmpfs workspace with a read-only source mount and no host dependencies/credentials copied. It exercised process-level SQLite crash/reopen, not power-loss durability of tmpfs.

The first Linux attempt passed package builds and bundle comparison but stopped during an unnecessary native dependency install because Docker's filesystem ran out of space. No unrelated Docker data was pruned. Provider-free CI/setup now deliberately skips dependency install hooks, since it does not bootstrap the local Letta CLI. A regression enforces this. The complete clean Linux rerun passed using temporary memory; the downloaded test image and owned containers were removed afterward. This workaround is not a claim that the host's disk pressure was resolved.

## What the packed gate proves

`scripts/release/packed-consumer.mjs` creates a fresh temporary home/config/cache environment, excludes host credentials and Node injection variables, packs both actual manifests, validates tarball identity/paths/exports/licenses/notices, and installs through npm with scripts disabled. It accepts npm's observed array/object pack-result forms without assuming a fixed versioned filename.

An initial client-only installation proves the core loads with the optional Letta SDK absent. The full consumer then imports installed exports and the **installed standalone mod** under network/subprocess guards. A fake host checks disabled capability, two approval-required tools, successful activation, and idempotent unregister/disposal. No actual Letta installation, host mod registration, or backend execution is inferred from that fixture.

The ordinary Node fixture also executes loopback send/get, same-task continuation, shutdown, durable reopen, duplicate rejection, and second-owner refusal. Four harmless trusted-runner calls occur; no real agent/provider is created or contacted. The consumer receives Express types from the bridge's manifest, not an extra test-only installation.

Consumer NodeNext checking is strict with **`skipLibCheck: true`**, matching this repository. SDK 0.8.3's dependency declaration graph has missing exports and extensionless imports under full checking. Packaged declarations and consumer API use pass; upstream declaration cleanliness with `skipLibCheck: false` is not claimed.

## TDD and review

New tests failed first for missing metadata/helpers, absent public Express types, missing packed notices/changelog, skipped mod import/activation, and enabled CI install hooks. Implementations then passed the focused/full gates. The reviewer independently identified the same packed-mod execution gap and the consumer's unnecessary explicit Express-type installation; both were resolved and rechecked.

One macOS rerun exposed two existing timing-sensitive invoker fixtures: their 40ms polling budget / 45ms remaining shared budget could expire before the observation they intended to assert. A subsequent unchanged run passed. The final tests give those operations more scheduler headroom while retaining snapshot/cancel assertions and a deadline bound that still rejects an independently extended 500ms cleanup. This test-only stabilization was rechecked on macOS after the Linux run; production deadline behavior was not changed.

The standalone bundle check originally reported drift before package-local dependencies were installed: Bun had resolved through an ancestor checkout. Correct frozen setup produced byte-identical output. The tracked artifact was **not** blindly regenerated to conceal that mismatch.

## Reproduction and remaining gates

Use the ordered commands in [RELEASING.md](../RELEASING.md). `bun run release:bundle` must precede client builds; `bun run release:packed` requires built packages and public npm access. The Linux run performed the same frozen package-first checks, full tests, and packed gate in an isolated Node 24.19.0 container; its tmpfs workspace addressed local Docker disk exhaustion, not a product dependency.

Local session logs: `/tmp/a2a-phase6-final-tests.log`, `/tmp/a2a-phase6-packed-macos.log`, `/tmp/a2a-phase6-linux-tmpfs.log`. These are temporary diagnostics, not durable/public release artifacts; this document records their scope and outcome without secrets.

**Not executed in this phase:** GitHub-hosted `macos-14`/`ubuntu-24.04` jobs, registry publication/installation, new provider-backed turns, Python regression reruns, SDK local subprocess mode, Cloud-backed Letta storage, Windows, or broader Node/SDK/Code versions. Existing Phase 5 live SDK/Python/Docker evidence remains historical evidence for unchanged production source, not a new Phase 6 execution claim.

Preparation is complete within this declared profile. Actual CI results and separately approved prerelease publication/registry verification remain. A stable release still requires the full plan's acceptance gates; no further numbered implementation phase or implicit publication authorization is invented.
