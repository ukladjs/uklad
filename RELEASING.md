# Releasing Uklad packages

The coordinated package set lives in [`release.json`](release.json). Keep it aligned with package manifests, compatible peer ranges, the agent toolkit's `versions.json`, and the website release constants. Each entry remains in the complete package catalog; set `publish` to `true` only for packages receiving a new immutable version in the current release.

## One-time local npm setup

1. Confirm the `ukladjs` npm organization exists and the publishing account can create public scoped packages.
2. Enable MFA for the publishing account and authenticate only on the release machine with `npm login`.
3. Do not add an `NPM_TOKEN` to GitHub Actions or configure npm trusted publishing for this repository. Packages are published locally only.

## Release sequence

1. Update package versions, tags, and `publish` flags in `release.json`, then update package manifests and compatible peer ranges. Never mark an already-published version for publication.
2. Update `CHANGELOG.md`, package README pins, the agent toolkit compatibility set, and website metadata/install commands.
3. Run `pnpm run release:check`. Inspect every selected package's dry-run file list and package size.
4. Push the synchronized repositories and wait for their normal CI checks. Optionally run the **Verify release** workflow for an independent CI dry run; it has no npm credentials and cannot publish.
5. On the release machine, confirm the active npm identity with `npm whoami`, then publish with `UKLAD_RELEASE_CONFIRM=<release-id> pnpm run release:publish`. The release id is the `id` field in `release.json`.
6. Verify npm versions and dist-tags, install each package in a clean consumer, then tag the Uklad repository and publish the matching GitHub release.
7. Tag/release the agent toolkit only after its pinned npm packages resolve. Publish the website last so every public install link works.

Package versions are immutable. If a publish only partially completes, inspect the registry, bump only the unpublished/fixed package versions as needed, update the coordinated manifests, and rerun the full verification before resuming.
