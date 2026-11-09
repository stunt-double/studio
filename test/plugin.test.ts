import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { DIRECT_TOOL_SPECS } from '@stuntkit/browser-toolset/direct-tools';

const root = join(import.meta.dirname, '..');
const plugin = join(root, 'plugin');
const read = (...path: string[]) => readFileSync(join(...path), 'utf8');
const pkg = JSON.parse(read(root, 'package.json')) as { version: string };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test('plugin: manifest version matches the package', () => {
  const manifest = JSON.parse(read(plugin, '.claude-plugin', 'plugin.json'));
  assert.equal(manifest.name, 'stuntdouble');
  assert.equal(manifest.version, pkg.version);
});

test('plugin: every stuntdouble pin is the exact package version', () => {
  const pins = files(plugin).flatMap((file) => [
    ...readFileSync(file, 'utf8').matchAll(/stuntdouble@(\d[^\s"'`)]*)/g),
  ]);
  assert.ok(pins.length > 0);
  for (const [, version] of pins) assert.equal(version, pkg.version);
});

test('plugin: .mcp.json starts the pinned package as the local server', () => {
  const { mcpServers } = JSON.parse(read(plugin, '.mcp.json'));
  assert.deepEqual(Object.keys(mcpServers), ['local']);
  assert.deepEqual(mcpServers.local.args, ['-y', `stuntdouble@${pkg.version}`, 'mcp']);
});

test('plugin: the actor agent names only tools the MCP server registers', () => {
  const registered = new Set([
    ...DIRECT_TOOL_SPECS.map((spec) => spec.name),
    ...[...read(root, 'src', 'mcp.ts').matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]),
  ]);
  const agent = read(plugin, 'agents', 'stuntdouble-actor.md');
  const tools = [...agent.matchAll(/mcp__plugin_stuntdouble_local__([a-z_]+)/g)].map((m) => m[1]);
  assert.ok(tools.length > 0);
  for (const tool of tools) assert.ok(registered.has(tool), `${tool} is not registered`);
});

test('plugin: no file the directory would hold or refuse', () => {
  for (const file of files(plugin)) {
    assert.ok(!/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\.npmrc)$/.test(file), file);
    assert.ok(statSync(file).size < 256 * 1024, `${file} is over 256 KiB`);
  }
});
