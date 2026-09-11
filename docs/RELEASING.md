# Package release and support policy

## Current status

`letta-a2a-client` and `letta-a2a-bridge` are **unpublished `0.1.0-alpha.1` candidates**. Kyle selected MIT on 2026-09-11. Package/root licenses cover this project's code; the bundled A2A SDK retains its Apache-2.0 license and attribution in the client's `THIRD_PARTY_NOTICES.md`.

The established unscoped names returned npm registry 404 on 2026-09-11. This is not name ownership or a reservation; check again before publication. Both packages deliberately retain `private: true` and a rejecting `prepublishOnly` hook. No CI job publishes anything or receives registry credentials.

## Versions and supported configurations

The prerelease baseline pins A2A JS SDK **1.1.0**, Letta Agent SDK **0.8.3**, Letta Code App Server **0.30.25**, Node **24.19.0**, and build-time Bun **1.4.2**. Exact dependencies and frozen lockfiles govern repository verification. Downstream transitive dependency resolution can differ; clean tarball tests exercise that actual installation boundary.

Node engine admission is `>=24.19.0 <25`, narrowed from the earlier unverified Node 22 declaration. This is not certification of every future Node 24 patch. Bun is a build/test tool, not a library runtime dependency. Client core consumers need no Letta SDK; the optional `./agent-sdk` adapter's types require SDK 0.8.3. Bridge consumers receive SDK 0.8.3 and the Express types exposed by its public declarations.

Consumer TypeScript checking uses strict NodeNext with `skipLibCheck`, matching the repository. Pinned upstream Letta SDK declarations contain missing exports and extensionless imports under full dependency declaration checking. The gate checks consumer API use and packaged declaration availability; it does **not** claim clean upstream declarations with `skipLibCheck: false`.

Keep these dimensions separate:

| Dimension | Executed evidence / boundary |
|---|---|
| Ordinary Node/macOS | Node 24.19.0 on macOS 26.6.2 arm64; library/packed consumer and local SQLite profile |
| Ordinary Node/Linux | Phase 5 exercised Node 24.19.0 in Linux containers with the durable service; Phase 6 evidence separately records clean package checks |
| SDK transport | `backend: "remote"` over WebSocket to Code 0.30.25 App Server was exercised with real turns, continuation, governed tools, cancellation uncertainty, and readback |
| Letta persistence backend | Those App Servers use **local** Letta storage. This does not mean SDK `backend: "local"` subprocess mode was tested |
| SDK local subprocess mode | Not certified in this release profile; isolated fake-SDK fixtures do not establish real subprocess/bootstrap compatibility |
| Cloud-backed Code App Server | Not certified. A remote URL alone does not prove Cloud identity, storage, tool permissions, or lifecycle parity |
| Bare Letta REST server | Not interchangeable with the Agent SDK App Server protocol; not an advertised direct bridge transport |
| Windows, Node 22/25+, other Bun/SDK/Code versions | Not certified. Windows-specific process/SQLite/shutdown behavior needs its own evidence |

CI config targets `macos-14` and `ubuntu-24.04` with the pinned Node/Bun versions. **Configured CI is not an executed result**; consult the actual workflow run and dated evidence. Local macOS 26 evidence is not proof of macOS 14 CI. Python/Docker/provider-backed integration remains a separate release checklist dimension, not something simulated package fixtures replace.

## Reproducible build and tarball gates

From a fresh checkout, preserve this ordering. The stale-bundle gate must run **before** any ordinary client build/check can overwrite committed output:

```sh
(cd packages/letta-a2a-client && bun install --frozen-lockfile --ignore-scripts)
(cd packages/letta-a2a-bridge && bun install --frozen-lockfile --ignore-scripts)
bun run release:bundle
(cd packages/letta-a2a-client && bun run check)
(cd packages/letta-a2a-bridge && bun run check && bun run build)
bun install --frozen-lockfile --force --ignore-scripts
(cd examples/14-typescript-letta-agent-sdk && bun install --frozen-lockfile --force --ignore-scripts && bun run check)
bun run check
bun run build
bun test
bun run release:packed
```

The bundle check builds twice into temporary paths and compares both outputs byte-for-byte with tracked `packages/letta-a2a-client/dist/a2a-client.mjs`. It never regenerates that tracked file. A mismatch means inspect dependency setup and the source/toolchain change; deliberately rebuild only after understanding the drift. Frozen package-local installation matters: missing dependencies can otherwise resolve through an ancestor checkout and change bundle provenance.

These provider-free gates disable dependency installation scripts: they do not need to bootstrap a local Letta CLI or build its native terminal dependencies. This is not a claim that SDK local subprocess mode works without its normal installation requirements; that mode is outside the certified profile above.

The packed gate uses temporary homes, actual npm tarball installation with lifecycle scripts disabled, ordinary Node, and harmless fixture execution. It tests packaging and local lifecycle—not real model/backend behavior. It does not contact a model provider, create a real Letta agent, publish a package, or use a host's npm/Letta credentials. Registry access is needed to install public dependencies. The gate's own child processes have deadlines; all temporary state is removed on normal success/failure.

## Semantic versioning

- Both packages begin at `0.1.0-alpha.1`; increment `alpha.N` for subsequent candidate changes and record them in the package changelog.
- Pre-1.0 does not promise a frozen API. Document breaking public changes and advance the minor version outside one prerelease series; reserve patches for compatible corrections.
- The packages can version independently after the initial paired candidate. SDK/Code upgrades are explicit compatibility changes requiring the relevant transport, policy, disposal, and recovery gates—not an automated version bump.
- A stable release requires the plan's acceptance gates, reviewed limitations, and an explicit support promise. Passing repository-local tests or publishing an alpha is insufficient.

## Publication—separate owner approval required

Do not publish as part of implementation or Git delivery. After explicit approval for the exact versions, registry, publisher identity, and dist-tag:

1. Verify the intended npm account controls the names and has appropriate authentication/2FA. Never put tokens in repository files, test output, or memory.
2. Review the complete candidate diff, changelogs, license notices, packed contents, and real CI results. Rerun the gates above, plus the applicable provider/Python/Docker checks. Resolve blockers rather than weakening checks.
3. In a reviewed change, remove `private` and the publication-denial hook. Build/package again; do not use `--ignore-scripts` to bypass the publication gate. The candidate remains a prerelease; choose an explicit non-`latest` dist-tag such as `alpha`.
4. Publish only the reviewed package versions. Registry publication is not reversible by ordinary Git rollback; do not assume unpublish will be available.
5. Install those **registry versions**, not local tarballs, in fresh temporary homes and rerun the consumer checks. Registry installation/provenance is unproven until this actually happens.

Deployment, credentials, TLS, tenant isolation, operator reconciliation, backups, and observability remain application responsibilities. Shared agent memory is not tenant isolation; SDK interruption is not backend-stop evidence; no automatic replay or exactly-once remote-work guarantee is introduced by packaging.
