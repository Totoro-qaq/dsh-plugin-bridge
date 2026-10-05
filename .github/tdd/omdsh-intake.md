# OMDSH declaration checks — 2026-10-05

Scope: proposed intake metadata and documentation only. Runtime source, generated lib, dependencies, SDK pins and the declared Host range are unchanged. Author review precedes committing/pushing this proposal and precedes any public submission.

## RED and GREEN

`node --test test/workshop.test.mjs` initially executed all three checks and failed 0/3 because `package.json#dshWorkshop` was absent. After adding the declaration, the identical target passed 3/3.

The checks cover the existing Profile Bundle/artifact, safe public evidence paths and permission labels, named Host versions, and explicit null failure-injection/hot-reload evidence. They do not verify Workshop's transaction envelope or its old baseline.

`npm run verify` passed 237 tests, typecheck, source/lib synchronization, datasets and package smoke (63 files). `validateWorkshopManifest()` from Workshop commit `6c3ec7b496d57272c65d79581722051b6c8f4a41` returned no errors. No runtime-coverage percentage is claimed for the metadata change.

The declaration is not present in the existing public release commit or npm 0.4.1. A v2 Issue cannot be submitted as source-bound until an approved public commit and matching artifact coordinate exist. No checkpoint commits, public Issue, or Hub Catalog/Registry changes have been created in this preparation phase.
