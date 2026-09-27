# Stable 1.0.0 release checklist

Package identity is **graphit-cmp@1.0.0** (CLI binary command: `graphit`). Nothing in this work automatically publishes a package or triggers an unprompted release.

## Publication readiness

- **Package identity resolved**: The package is registered for publication as `graphit-cmp` version `1.0.0`, resolving previous naming conflicts with unrelated packages.
- **Cross-platform verification**: The Node 22 matrix (Windows x64, Ubuntu/Linux, macOS) is verified and green across CI.
- **Publication status**: Publication has not happened yet.
- **Trusted publishing**: npm Trusted Publishing and protected GitHub environments require owner configuration if using OIDC. No token is embedded in this repository.

## Verification

Release verification across Node 22 (Windows, Linux, macOS):
All tests pass; build, typecheck, lint, pack dry-run, pack and tarball audit pass. The normally installed tarball passes CLI, encrypted portability and four tamper cases, plus real MCP stdio restart/cross-provider continuation (13 tools, 3 resources). No experimental SQLite warning is emitted.
P3 retains 6/6 required evidence: 27,664 → 1,961 estimated tokens (92.91% reduction).
Resolver precision remains five expected calls and zero false-positive calls.

### Profile and bounded optimization

The deterministic fixture has 1,000 files, 22,000 symbols and 80,000 edges.
Before changing runtime code, SQL/CPU profiling showed that unchanged indexing
parsed zero files but deleted and reinserted all graph rows. Edge deletion/insertion
alone took 4.78s; repeated graph assembly, extraction validation, serialization,
hashing and GC added further cost. There were eight event-history reads, two full
graph reads and 2,000 blob reads, but no FTS access or rebuild.

An unchanged completion now checks graph hash and exact canonical observation
identities inside its transaction, verifies preserved blob hashes/lengths, then
advances run state without rebuilding/resolving/rewriting the graph. The indexer
reuses the already-validated edge count. Started/completed events still append.
Corrupt projections fall back to rebuilding. Reopen, no-rewrite, corruption and
changed-target tests protect correctness. No schema, source/event format or
retrieval/resolver algorithm changed.

| Instrumented local measurement | Before | After |
| --- | ---: | ---: |
| Initial index | 226.13s | 385.70s |
| Unchanged index | 19.32s | 8.84s |
| One-file incremental | 17.79s | 25.21s |
| Peak RSS | 1.46 GB | 1.34 GB |

Unchanged graph-row rewrites fell from 103,000 inserts plus table deletes to zero,
a 54.2% wall-time reduction in this run. Initial/incremental timings were **worse**,
not improved. Those paths were intentionally not optimized; the after run overlapped
other verification activity. Single runs with profiling are not controlled
performance guarantees and cannot establish a causal regression or improvement
outside the optimized path. The earlier packaged P6C baseline was 288.09s / 20.04s /
20.69s and 1.56 GB; it remains preserved separately.

Changing one file still builds global relationships and republishes projections.
Keeping that behavior avoids stale cross-file edges. Remaining unchanged cost is
full graph/source integrity checks, history replay, filesystem reads and hashing.
Do not claim near-zero reindex time or large-repository performance readiness.
See `benchmarks/release-performance.json`, `release-profile-before.json`,
`release-profile-after.json`, `release-p3-regression.json`,
`release-resolver.json` and `release-packed-verification.json`.

`.github/workflows/ci.yml` runs on pushes to main, pull requests, manual requests
and reusable calls. The Node 22 matrix covers Windows, Ubuntu and macOS. Each job
runs normal `npm ci`, build, tests, typecheck, lint, pack, tarball audit and the
isolated packed verifier. It needs no Docker. Native SQLite and Tree-sitter are
installed normally. The verifier includes the requested CLI commands, a 1,000-token
context, encrypted roundtrip/tampering and actual MCP stdio cross-provider restart.

Local reproduction:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm pack --dry-run
npm pack
npm run audit:pack
npm run verify:packed
node scripts/regression-p6c.mjs
```

The large synthetic benchmark is deliberately not a per-PR CI requirement.
Set `GRAPHIT_PROFILE=1` when running `scripts/stress-p6c.mjs` to record SQL
counts/timings per phase and CPU self-time samples for unchanged indexing.
This is benchmark-only instrumentation, not telemetry or runtime profiling.

## Manual publication gate

`.github/workflows/release.yml` has **only workflow_dispatch**; no push/tag/release
event publishes. Leaving its confirmation blank performs three-platform verification
only. Publishing additionally requires all of:

1. Package identity is configured as `graphit-cmp@1.0.0`. Review the exact tarball (`graphit-cmp-1.0.0.tgz`).
2. Configure npm Trusted Publishing for owner `1221smolkiddo`, repository
   `graphit`, workflow `release.yml`, environment `npm`. Allow `npm publish`.
3. Create GitHub environment `npm` with required reviewers and main-only deployment
   restrictions. Set repository variable `ENABLE_NPM_PUBLISH=true` only when ready.
4. An owner explicitly dispatches from main with confirmation `publish graphit-cmp@1.0.0`. All three platforms must pass first.
5. The protected publishing job repeats verification and checks the registry before
   publishing the inspected tarball using OIDC/provenance, with no npm token secret.

The release job pins npm 11.6.2; trusted publishing needs npm >=11.5.1 and
Node >=22.14, supplied by the current Node 22 setup. Its registry preflight fails
closed on network errors or if a version already exists.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [GitHub Node workflows](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs).
