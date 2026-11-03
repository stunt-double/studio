# Contributing

Thanks for helping. Issues and pull requests are welcome; for anything larger than a fix, open an issue first so we can agree on the shape before you spend time on it.

By taking part you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Developer Certificate of Origin

Every commit must be signed off, certifying that you wrote it or otherwise have the right to submit it under the project's licence ([developercertificate.org](https://developercertificate.org/)):

```sh
git commit -s -m "fix(studio): ..."
```

This adds a `Signed-off-by: Your Name <you@example.com>` line matching your Git identity. To sign off commits you already made on your branch: `git rebase --signoff main`.

## The dev loop

You need Node 22.18 or later (`node --test` runs the TypeScript source directly, with type stripping), pnpm 11 (`corepack enable` picks up the version pinned in `package.json`) and Google Chrome for the end-to-end tests, which skip without it.

```sh
pnpm install
pnpm test          # node --test, including the headless Chrome end-to-end tests
pnpm type-check    # tsc
pnpm lint          # ESLint (typescript-eslint)
pnpm format        # Prettier (CI runs pnpm format:check)
pnpm build         # tsup: dist/cli.js, with browser-toolset bundled in
```

Conventions:

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(studio): ...`, `fix: ...`, `docs: ...`).
- Source imports use explicit `.ts` extensions, and tests use `node:test` and `node:assert/strict`, so the source runs under `node --test` without a build. Avoid TypeScript syntax that type stripping rejects (parameter properties, enums, namespaces); `erasableSyntaxOnly` in `tsconfig.json` catches it.
- `src/vendor/scoring/` is vendored verbatim from the Stunt Double monorepo, so a local run scores exactly as a cloud run does. Do not edit it here.
- `test/no-model.test.ts` holds the policy line in the README: nothing in the MCP server calls a model, and nothing uses a Claude subscription. Keep it passing.
- No emdash characters, in code or prose. British English in prose.

## Changesets

Every pull request that changes what `stuntdouble` does includes a changeset:

```sh
pnpm changeset
```

Pick the bump (patch for fixes, minor for features, and while the package is below 1.0, minor for breaking changes too), and write a sentence or two for the changelog. Commit the generated file in `.changeset/` with your change. Changes to CI or docs need none.

Releases are automatic. On every push to `main`, `.github/workflows/release.yml` runs [changesets/action](https://github.com/changesets/action): while changesets are pending it keeps a "Version packages" pull request open that bumps the version and writes the changelog, and merging that pull request runs `scripts/publish-npm.mjs`. That publishes to npm with `npm publish --provenance`, waits until npm lists the version, tags it `stuntdouble@<version>` and creates its GitHub release from the changelog entry.

Publishing goes through npm trusted publishing: npm exchanges the job's GitHub OIDC token, so there is no npm token or secret. The trust relationship is configured once on npm (`npm trust github stuntdouble --repo stunt-double/studio --file release.yml --allow-publish`, which needs 2FA). Never publish from a laptop: a version published by hand skips provenance, and npm refuses the same version from CI afterwards.

## browser-toolset

The browser tools come from [`@stuntkit/browser-toolset`](https://github.com/stunt-double/stuntkit/tree/main/packages/browser-toolset) in StuntKit, on npm. It is pinned to an exact version in `devDependencies` and bundled into `dist/` by tsup's `noExternal`, so `stuntdouble` has no runtime dependency on it. To take a new version, bump the pin, run `pnpm install` and add a changeset.

It used to be `@stunt-double/browser-toolset` on GitHub Packages, which needed a token with `read:packages` for every install. StuntKit moved it to npm under the `@stuntkit` scope (stunt-double/stuntkit#49, PRO-2980) ahead of this repository's move, so installs need no token and CI needs no `packages` permission.

## Where this came from

This repository was extracted from `packages/local` in [stunt-double/stuntkit](https://github.com/stunt-double/stuntkit), keeping its history: each extracted commit carries a `StuntKit-Commit:` trailer, and `(stunt-double/stuntkit#123)` points at the pull request it came from. `scripts/extract-from-stuntkit.sh` rebuilds that history from a StuntKit branch and replays this repository's own commits on top; it is for the move only, and once StuntKit stops changing `packages/local` it can go.
