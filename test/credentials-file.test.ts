/**
 * The secrets file: 0600 in a 0700 folder, written whole, and read as empty
 * rather than trusted when it is missing, corrupt or the wrong shape.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import {
  forgetCredentials,
  readCredentials,
  updateCredentials,
  writeCredentials,
} from '../src/credentials-file.ts';

let parent: string;
let home: string;
const file = () => join(home, 'credentials.json');

before(async () => {
  parent = await mkdtemp(join(tmpdir(), 'stuntdouble-home-'));
  // A folder that does not exist yet, so the write has to make it.
  home = join(parent, 'home');
  process.env.STUNTDOUBLE_HOME = home;
});

after(async () => {
  await rm(parent, { recursive: true, force: true });
});

test('no file reads as empty', async () => {
  assert.deepEqual(await readCredentials(), {});
});

test('a write makes a 0700 folder and a 0600 file, and leaves no temp file', async () => {
  await writeCredentials({ connection: { provider: 'anthropic' } });
  assert.equal((await stat(home)).mode & 0o777, 0o700);
  assert.equal((await stat(file())).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(home), ['credentials.json']);
  assert.deepEqual(await readCredentials(), { connection: { provider: 'anthropic' } });
});

test('a corrupt or wrongly shaped file reads as empty', async () => {
  await writeFile(file(), '{not json', { mode: 0o600 });
  assert.deepEqual(await readCredentials(), {});
  await writeFile(file(), JSON.stringify({ cloud: { server: 42 } }), { mode: 0o600 });
  assert.deepEqual(await readCredentials(), {});
});

test('an update keeps what it does not touch, keys this version does not know included', async () => {
  await writeFile(file(), JSON.stringify({ connection: { provider: 'openai' }, later: 1 }));
  const next = await updateCredentials((c) => ({
    ...c,
    cloud: { server: 'https://app.test/api/mcp' },
  }));
  assert.deepEqual(next, {
    connection: { provider: 'openai' },
    later: 1,
    cloud: { server: 'https://app.test/api/mcp' },
  });
  assert.deepEqual(await readCredentials(), next);
  // The file existed with the default mode; a write tightens it.
  assert.equal((await stat(file())).mode & 0o777, 0o600);
});

test('forget removes the file, and forgetting twice is fine', async () => {
  await forgetCredentials();
  await forgetCredentials();
  assert.deepEqual(await readCredentials(), {});
  await assert.rejects(stat(file()), { code: 'ENOENT' });
});
