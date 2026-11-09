// Keeps the Claude Code plugin in `plugin/` on the package's version: its
// `plugin.json` version and every `stuntdouble@x.y.z` pin in the plugin.
// `pnpm version-packages` runs it after `changeset version`, so the
// "Version packages" pull request moves the plugin with the package.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pin = /stuntdouble@\d+\.\d+\.\d+(?:-[\w.]+)?/g;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const manifest = join(root, 'plugin', '.claude-plugin', 'plugin.json');
for (const file of files(join(root, 'plugin'))) {
  if (!/\.(json|md|mjs)$/.test(file)) continue;
  const before = readFileSync(file, 'utf8');
  let after = before.replace(pin, `stuntdouble@${version}`);
  if (file === manifest) after = after.replace(/"version": "[^"]+"/, `"version": "${version}"`);
  if (after !== before) writeFileSync(file, after);
}
console.log(`plugin: stuntdouble@${version}`);
