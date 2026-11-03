// Publishes `stuntdouble` to npm with `npm publish --provenance`, through npm
// trusted publishing (the GitHub Actions OIDC exchange, npm 11.5.1 or later),
// so there is no npm token. changesets/action runs it as the publish step once
// the "Version packages" pull request has merged. A version npm already has is
// skipped, so a re-run is safe.
//
// After publishing it waits until npm lists the version, tags it
// `stuntdouble@<version>` and prints "New tag:", the line changesets/action
// reads to push the tag and create the GitHub release.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const REGISTRY = 'https://registry.npmjs.org';
const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));
const spec = `${name}@${version}`;

const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] })
    .toString()
    .trim();

const onNpm = () => {
  try {
    return run('npm', ['view', spec, 'version', '--registry', REGISTRY]) === version;
  } catch {
    return false; // 404: not published yet.
  }
};

if (onNpm()) {
  console.log(`${spec} is already on npm`);
  process.exit(0);
}

execFileSync('npm', ['publish', '--access', 'public', '--provenance', '--registry', REGISTRY], {
  stdio: 'inherit',
});

// The registry can take a while to list a new version.
for (let attempt = 1; !onNpm(); attempt++) {
  if (attempt === 30) throw new Error(`${spec} was published but npm does not list it yet`);
  await sleep(10_000);
}

run('git', ['tag', spec]);
console.log(`New tag: ${spec}`);
