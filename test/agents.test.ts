/**
 * Which agents are connected: the registry under `.stuntdouble/.live/agents/`,
 * the client-name mapping, `runner.client` on a run an agent starts, and the
 * Studio route that lists them, behind the viewer's Host check and key.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  agentKind,
  agentLabel,
  listAgents,
  registerAgent,
  unregisterAgent,
} from '../src/agents.ts';
import type { LocalDriver } from '../src/driver.ts';
import { RunSchema } from '../src/files.ts';
import { createServer } from '../src/mcp.ts';
import { LocalSession } from '../src/run.ts';
import { startStudio } from '../src/studio.ts';

const dirs: string[] = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'stuntdouble-agents-'));
  dirs.push(dir);
  const sd = join(dir, '.stuntdouble');
  await mkdir(join(sd, 'actors'), { recursive: true });
  await mkdir(join(sd, 'checklists'), { recursive: true });
  await writeFile(join(sd, 'stuntdouble.json'), JSON.stringify({ format: 'stuntdouble/1' }));
  await writeFile(join(sd, 'actors', 'shopper.json'), JSON.stringify({ name: 'Shopper' }));
  await writeFile(
    join(sd, 'checklists', 'checkout.json'),
    JSON.stringify({
      name: 'Checkout',
      actor: 'shopper',
      url: 'https://shop.example.com/',
      instructions: 'Buy a mug.',
      checks: [{ key: 'search-box', description: 'There is a search box' }],
    })
  );
  return dir;
}

const sdOf = (dir: string) => join(dir, '.stuntdouble');

/** A browser that never renders: enough for start_run. */
const fakeDriver = () => {
  const page = {
    id: 'p',
    goto: async () => {},
    url: () => 'about:blank',
    title: async () => '',
    screenshot: async () => Buffer.from('png'),
    evaluate: async () => ({ ok: true, text: '', truncated: false }),
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    close: async () => {},
  };
  return {
    context: { activePage: async () => page, pages: async () => [page] },
    takeRefusal: () => null,
    close: async () => {},
  } as unknown as LocalDriver;
};

test('client names map to labels, and anything unknown keeps its name', () => {
  assert.equal(agentLabel('claude-code'), 'Claude Code');
  assert.equal(agentLabel('codex-mcp-client'), 'Codex');
  assert.equal(agentLabel('codex'), 'Codex');
  assert.equal(agentLabel('cursor-vscode'), 'MCP client cursor-vscode');
  assert.equal(agentKind('claude-code'), 'claude-code');
  assert.equal(agentKind('codex-mcp-client'), 'codex');
  assert.equal(agentKind('mcp-inspector'), 'other');
});

test('a connection is written, listed, and removed on shutdown', async () => {
  const root = sdOf(await project());
  await registerAgent(root, '/work/shop', { name: 'codex-mcp-client', version: '0.166.0' });
  const [agent] = await listAgents(root);
  assert.equal(agent!.label, 'Codex');
  assert.equal(agent!.version, '0.166.0');
  assert.equal(agent!.pid, process.pid);
  assert.equal(agent!.project, '/work/shop');
  assert.ok(Date.parse(agent!.started_at) > 0);
  // Written whole: no temp file is left beside it.
  assert.deepEqual(await readdir(join(root, '.live', 'agents')), [`${process.pid}.json`]);
  await unregisterAgent(root);
  assert.deepEqual(await listAgents(root), []);
  await unregisterAgent(root); // already gone is fine
});

test('an entry whose pid is dead is gone, and tidied away', async () => {
  const root = sdOf(await project());
  await registerAgent(root, '/work/shop', { name: 'claude-code', version: '2.1.0' }, 2 ** 22 + 7);
  await writeFile(join(root, '.live', 'agents', '9.json'), 'not json');
  assert.deepEqual(await listAgents(root), []);
  assert.deepEqual(await readdir(join(root, '.live', 'agents')), ['9.json']);
});

test('the server records who connected, and the run it starts names them', async () => {
  const dir = await project();
  const session = new LocalSession({ project: dir, launch: async () => fakeDriver() });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = createServer(session);
  await server.connect(serverSide);
  const client = new Client({ name: 'codex-mcp-client', version: '0.166.0' });
  await client.connect(clientSide);
  for (let n = 0; n < 50 && !(await listAgents(sdOf(dir))).length; n++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal((await listAgents(sdOf(dir)))[0]?.label, 'Codex');

  const reply = await client.callTool({ name: 'start_run', arguments: { checklist: 'checkout' } });
  const text = JSON.stringify(reply.content);
  // The reply carries the agent through: the brief, the verdict tool and the end.
  assert.match(text, /evaluate_check/);
  assert.match(text, /finish_run/);
  const [id] = await readdir(join(sdOf(dir), 'runs'));
  const run = RunSchema.parse(
    JSON.parse(await readFile(join(sdOf(dir), 'runs', id!, 'run.json'), 'utf8'))
  );
  assert.deepEqual(run.runner.client, { name: 'codex-mcp-client', version: '0.166.0' });
  assert.equal(run.runner.kind, 'local');
  await client.close();
  await session.close();
});

test('a run from a session with no client has no runner.client', async () => {
  const dir = await project();
  const session = new LocalSession({ project: dir, launch: async () => fakeDriver() });
  await session.startRun({ checklist: 'checkout' });
  const [id] = await readdir(join(sdOf(dir), 'runs'));
  const run = RunSchema.parse(
    JSON.parse(await readFile(join(sdOf(dir), 'runs', id!, 'run.json'), 'utf8'))
  );
  assert.equal(run.runner.client, undefined);
  await session.close();
});

test('the Studio lists connected agents behind the Host check and the key', async () => {
  const dir = await project();
  const home = await mkdtemp(join(tmpdir(), 'stuntdouble-home-'));
  dirs.push(home);
  process.env.STUNTDOUBLE_HOME = home;
  const app = await startStudio({ project: dir, port: 4831 });
  after(() => app.close());
  const host = `127.0.0.1:${app.ui.port}`;
  const call = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((ok, bad) => {
      const req = request(
        { host: '127.0.0.1', port: app.ui.port, path, method, headers: { Host: host, ...headers } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => ok({ status: res.statusCode!, body, headers: res.headers }));
        }
      );
      req.on('error', bad);
      req.end();
    });
  const signIn = await call(`/?t=${app.ui.token}`);
  const cookie = String(signIn.headers['set-cookie']).split(';')[0]!;

  assert.equal((await call('/api/studio/agents')).status, 403, 'no key');
  assert.equal(
    (await call('/api/studio/agents', { Cookie: cookie, Host: 'evil.example' })).status,
    403
  );
  // Read only: a write to it is refused whatever the Origin.
  const post = await call(
    '/api/studio/agents',
    { Cookie: cookie, Origin: `http://${host}`, 'Content-Type': 'application/json' },
    'POST'
  );
  assert.equal(post.status, 404);

  const empty = await call('/api/studio/agents', { Cookie: cookie });
  assert.equal(empty.status, 200);
  assert.equal(empty.headers['access-control-allow-origin'], undefined);
  assert.deepEqual(JSON.parse(empty.body), { agents: [] });

  await registerAgent(sdOf(dir), dir, { name: 'claude-code', version: '2.1.0' });
  const listed = JSON.parse((await call('/api/studio/agents', { Cookie: cookie })).body);
  assert.equal(listed.agents[0].label, 'Claude Code');
  assert.equal(listed.agents[0].kind, 'claude-code');
  await unregisterAgent(sdOf(dir));
});
