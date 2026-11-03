# Moving `stuntdouble` to stunt-double/studio

The steps only a maintainer with org and npm access can do, in order. Tracking issue: PRO-2980. Delete this file once the first release from this repository is out.

## Before the first push

- [ ] **Final extraction.** Once StuntKit has merged everything for `packages/local` (#47, `feat/run-feedback`, `feat/studio-agents`), rebuild this repository on the latest StuntKit `main`:

  ```sh
  FILTER_REPO=/path/to/git-filter-repo scripts/extract-from-stuntkit.sh main
  ```

  It keeps the extracted commits' hashes, adds the new StuntKit commits, re-carries StuntKit's pending `stuntdouble` changesets and replays this repository's own commits with `git am -3`. On a conflict (most likely `package.json` or `README.md`), resolve it and run `git am --continue`. Then run `pnpm install`, commit `pnpm-lock.yaml` if it changed, and run the checks in CONTRIBUTING.md.

- [ ] **Publish `@stuntkit/browser-toolset@0.2.1` to npm** from StuntKit (the manual first publish stunt-double/stuntkit#49 describes), then set up its trusted publishing there. Until it is on npm, `pnpm install` here fails with a 404.

- [ ] **Lockfile.** `pnpm-lock.yaml` was written before that publish, against a local build of 0.2.1, so its `@stuntkit/browser-toolset` integrity will not match npm's and `pnpm install --frozen-lockfile` fails on it. Once 0.2.1 is on npm, drop that entry, let pnpm resolve it again, check the diff is one `integrity` line, and amend the commit that added the lockfile:

  ```sh
  node -e "const f=require('fs'),b=f.readFileSync('pnpm-lock.yaml','utf8').split(/\n(?=\n)/);f.writeFileSync('pnpm-lock.yaml',b.map(x=>x.replace(/\n {6}'@stuntkit\/browser-toolset':\n {8}specifier: .*\n {8}version: .*/,'')).filter(x=>!/^\n  '@stuntkit\/browser-toolset@/.test(x)).join('\n'))"
  pnpm install && git diff pnpm-lock.yaml
  ```

- [ ] **Push** `main` and the `stuntdouble@*` tags (lightweight, so `--follow-tags` skips them): `git push -u origin main --tags`.

## npm trusted publishing

Move the trust relationship from StuntKit to this repository (needs npm 11.5.1 or later and 2FA):

- [ ] `npm trust list stuntdouble`, and note the id of the StuntKit entry.
- [ ] `npm trust revoke --id <id> stuntdouble`
- [ ] `npm trust github stuntdouble --repo stunt-double/studio --file release.yml --allow-publish`

From here StuntKit can no longer publish `stuntdouble`. Remove `packages/local` from StuntKit in the same window (and its entry in StuntKit's `scripts/publish-npm.mjs`), so its release workflow stops trying.

## Repository settings

- [ ] **Branch protection on `main`:** require a pull request, require the CI checks (`Lint, type-check, test, build (Node 22)` and `(Node 24)`) and CodeQL, require branches to be up to date, block force pushes and deletions.
- [ ] **Actions:** Settings, Actions, General, Workflow permissions: allow GitHub Actions to create and approve pull requests, so the release workflow can open the "Version packages" pull request.
- [ ] **Security:** turn on private vulnerability reporting (SECURITY.md links to it), Dependabot alerts and security updates.
- [ ] **Make the repository public** once the above is in place and the history has been checked for anything private.
- [ ] Update the `homepage`, `repository` and `bugs` links in StuntKit's docs, the Stunt Double plugin and the docs site that point at `stuntkit/tree/main/packages/local`.

## First release

- [ ] Merge a pull request with a changeset (the carried `studio-standalone` changeset does if StuntKit has not released it). The release workflow opens "chore: version packages".
- [ ] Merge that pull request. Check the run publishes with provenance (`npm view stuntdouble@<version> --json` shows `dist.attestations`), pushes the `stuntdouble@<version>` tag and creates the GitHub release. A 403 or E404 from `npm publish` means the trust relationship above is missing or names the wrong repository or file.
