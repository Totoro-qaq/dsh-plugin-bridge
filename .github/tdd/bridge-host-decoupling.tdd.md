# BridgeHost decoupling — TDD evidence

## Source and journeys

No plan file was supplied. The implementation derived these journeys from the requested host decoupling:

1. As an adapter author, I can provide typed Bridge host capabilities without exposing DSH RPC route strings to the migration engine.
2. As an existing Bridge caller, I can continue passing the 0.2.x `Rpc` function without a breaking change.
3. As a user, the current WebUI and CLI paths keep the same preview, migration, image, and fail-closed behavior.
4. As an adapter author, I can inspect and test the host contract through a dedicated package subpath.

## RED → GREEN evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| Baseline | `npm test` | PASS | 126/126 tests before the change |
| RED | `node --experimental-strip-types --test test/host-port.test.mjs` | Expected failure | `ERR_MODULE_NOT_FOUND` for the not-yet-created `src/host.ts`; checkpoint `56e1b33` |
| Focused GREEN | `node --experimental-strip-types --test test/host-port.test.mjs` | PASS | Typed host object completed preview; semantic probe and `hostFor` command path passed |
| Full GREEN | `npm test` | PASS | 132/132 tests, including CLI HTTP, Cordis loading, goal fail-closed, image fallback, and package subpath tests |
| Coverage | `node --experimental-strip-types --experimental-test-coverage --test-coverage-include='src/**/*.ts' --test test/*.test.mjs` | PASS | Source line 93.54%, branch 76.72%, function 87.23% |
| Release gate | `npm run verify` | PASS | Build/typecheck, 132 tests, generated `lib/`, dataset checks, and installed tarball smoke; 34 packed files |

## Guarantees

| Guarantee | Test/evidence |
|---|---|
| Migration accepts a typed `BridgeHost` rather than requiring a callable RPC | `test/host-port.test.mjs` |
| DSH route strings remain inside adapters and are absent from `src/migrate.ts` | `test/host-port.test.mjs` static boundary check |
| Partial third-party adapters are reported by doctor without crashing the probe | `test/host-port.test.mjs` |
| Existing `Rpc` callers keep working | Existing migration tests plus `createBridgeHostFromRpc()` compatibility adapter |
| WebUI uses the in-process adapter and CLI uses the HTTP adapter | `test/load.test.mjs`, `test/cli.test.mjs` |
| Public adapter entrypoint is built and packed | `test/load.test.mjs`, `scripts/package-smoke.mjs` |
| Goal pause failure still clears/cancels and never sends kickoff | Existing `test/migrate.test.mjs` fail-closed cases |

## Known gaps

- No third-party host adapter is implemented or claimed compatible in this change.
- This turn validates current paths with local, fake-host, Cordis, HTTP CLI, and installed-tarball checks; it does not repeat a live official-WebUI migration.
- Branch coverage is below 80% because several CLI error/display branches remain intentionally integration-only; source line and function coverage exceed 80%.
