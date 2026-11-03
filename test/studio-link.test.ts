/**
 * One viewer link: with a Studio open for the project, the MCP session links
 * Studio's pages and starts no viewer of its own; with none (never opened,
 * closed, crashed, or open for another project) it starts its own as before.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { LocalSession } from '../src/run.ts';
import { findStudio, studioLink, studioRecord } from '../src/studio-link.ts';
import { startStudio, type Studio } from '../src/studio.ts';
import { startUi } from '../src/ui-server.ts';
import { makeProject } from './helpers/project.ts';

let dir: string;
let other: string;
let root: string;
let studio: Studio | null = null;

const CONFIG = JSON.stringify({ format: 'stuntdouble/1' });
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  );

before(async () => {
  dir = await makeProject({ '.stuntdouble/stuntdouble.json': CONFIG });
  other = await makeProject({ '.stuntdouble/stuntdouble.json': CONFIG });
  root = join(dir, '.stuntdouble');
  process.env.STUNTDOUBLE_HOME = await makeProject();
});

after(async () => {
  await studio?.close();
  for (const d of [dir, other]) await rm(d, { recursive: true, force: true });
});

test('no record, no Studio: nothing to link', async () => {
  assert.equal(await findStudio(root), null);
});

test('a Studio open on a set-up project records itself, and is found', async () => {
  studio = await startStudio({ project: dir, port: 4860 });
  const record = await findStudio(root);
  assert.ok(record);
  assert.equal(record.port, studio.ui.port);
  assert.equal(record.pid, process.pid);
  assert.equal(record.url, `http://127.0.0.1:${studio.ui.port}`);
  assert.equal(studioLink(record, '/runs/x'), studio.link('/runs/x'));
  assert.equal(record.token, studio.ui.token);
  assert.equal((await stat(studioRecord(root))).mode & 0o777, 0o600);
  // The same file mode as the viewer's own record.
  const probe = await fetch(`http://127.0.0.1:${studio.ui.port}/__stuntdouble`);
  const body = (await probe.json()) as { stuntdouble: boolean; project: string };
  assert.equal(body.stuntdouble, true);
  assert.match(body.project, /^[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(body).includes(dir), 'the probe does not name the folder');
});

test('with a Studio open, openUi links it, starts no viewer and writes no server.json', async () => {
  const session = new LocalSession({ project: dir });
  try {
    const link = await session.openUi('/runs/20260101-000000-demo');
    assert.equal(link, studio!.link('/runs/20260101-000000-demo'));
    assert.equal(session.viewerPort, null, 'no second viewer');
    assert.equal(await exists(join(root, '.live', 'server.json')), false);
    // The overview (open_ui) says the same.
    assert.ok((await session.overview()).startsWith(studio!.link('/')));
    assert.equal(session.viewerPort, null);
  } finally {
    await session.close();
  }
});

test('without a Studio, openUi starts its own viewer as before', async () => {
  await studio!.close();
  studio = null;
  assert.equal(await exists(studioRecord(root)), false, 'closing removes the record');
  assert.equal(await findStudio(root), null);
  const session = new LocalSession({ project: dir });
  try {
    const link = await session.openUi();
    assert.ok(session.viewerPort);
    assert.ok(link.startsWith(`http://127.0.0.1:${session.viewerPort}/`));
    const server = JSON.parse(await readFile(join(root, '.live', 'server.json'), 'utf8'));
    assert.equal(server.port, session.viewerPort);
    assert.equal((await stat(join(root, '.live', 'server.json'))).mode & 0o777, 0o600);
  } finally {
    await session.close();
  }
});

/** A record that names this project but whose process or port does not hold up. */
async function plant(record: object) {
  await mkdir(join(root, '.live'), { recursive: true });
  await writeFile(studioRecord(root), JSON.stringify(record), { mode: 0o600 });
}

test('a stale record is ignored: the process is gone', async () => {
  const child = spawn(process.execPath, ['-e', '0']);
  await new Promise((ok) => child.on('exit', ok));
  const live = await startUi({ root });
  try {
    await plant({
      url: `http://127.0.0.1:${live.port}`,
      port: live.port,
      pid: child.pid,
      token: live.token,
    });
    assert.equal(await findStudio(root), null);
  } finally {
    await live.close();
  }
});

test('a stale record is ignored: the pid is alive but nothing answers on the port', async () => {
  await plant({ url: 'http://127.0.0.1:9', port: 9, pid: process.pid, token: 'x' });
  assert.equal(await findStudio(root), null);
  const session = new LocalSession({ project: dir });
  try {
    await session.openUi();
    assert.ok(session.viewerPort && session.viewerPort !== 9, 'falls back to its own viewer');
  } finally {
    await session.close();
  }
});

test('a record is ignored when the port serves another project', async () => {
  const elsewhere = await startUi({ root: join(other, '.stuntdouble') });
  try {
    await plant({
      url: `http://127.0.0.1:${elsewhere.port}`,
      port: elsewhere.port,
      pid: process.pid,
      token: elsewhere.token,
    });
    assert.equal(await findStudio(root), null);
    const session = new LocalSession({ project: dir });
    try {
      const link = await session.openUi();
      assert.ok(!link.startsWith(`http://127.0.0.1:${elsewhere.port}/`));
    } finally {
      await session.close();
    }
  } finally {
    await elsewhere.close();
  }
});

test('a record that does not parse is ignored', async () => {
  await plant({ url: 'http://127.0.0.1:1', port: 'one' });
  assert.equal(await findStudio(root), null);
  await writeFile(studioRecord(root), 'not json');
  assert.equal(await findStudio(root), null);
});

test('a session started by the Studio keeps using the Studio’s own viewer', async () => {
  studio = await startStudio({ project: dir, port: 4861 });
  const session = new LocalSession({ project: dir, ui: studio.ui });
  try {
    assert.equal(await session.openUi('/x'), studio.link('/x'));
    assert.equal(session.viewerPort, studio.ui.port);
  } finally {
    await session.close();
  }
});
